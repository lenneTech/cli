/**
 * Per-ticket parallel dev environments for `lt dev` (used by the `lt ticket`
 * command group).
 *
 * The model: ONE git repo, N git worktrees — one per ticket/feature — each on
 * its own branch (created fresh from `origin/dev` so tickets are independent),
 * each running its own `lt dev` stack on a SUFFIXED identity:
 *
 *   ticket "DEV-2200"  →  id "2200"  →  svl-2200.localhost / api.svl-2200.localhost
 *                         worktree  <parent>/svl-2200/   branch feat/DEV-2200
 *                         DB svl-sports-system-2200   (empty at start, isolated)
 *
 * A worktree is "tagged" with its ticket by a `.lt-dev/ticket` marker file the
 * moment `lt ticket start` creates it. From then on EVERY `lt dev *` command run
 * inside that worktree (up / down / test / status) reads the marker via
 * {@link resolveDevIdentity} and operates on the ticket's isolated stack — no
 * flags needed. So `lt ticket` only has to orchestrate the worktree + marker and
 * can delegate the actual bring-up/-down to the normal `lt dev` commands.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';

import { buildIdentity, buildTicketIdentity, DevIdentity, slugify } from './dev-identity';
import { pickPackageManager } from './dev-package-manager';
import { autoPatch } from './dev-patches';
import { deriveDbName, deriveTicketDbName, DevProjectLayout } from './dev-project';
import { paths } from './dev-state';

/** Marker file (under `.lt-dev/`) that tags a worktree with its ticket id. */
const TICKET_MARKER = 'ticket';

/** Result of the per-project global-setup ticket-safety check (for `lt dev doctor`). */
export interface GlobalSetupCheck {
  /** The global-setup file path, if found. */
  file: null | string;
  /** True if the global-setup actually resets a database. */
  hasDbReset: boolean;
  /** True if its allow-list accepts a per-ticket / per-shard `…-test` DB. */
  ticketSafe: boolean;
}

/** The resolved dev identity for a root — ticket-aware. */
export interface ResolvedDevIdentity {
  /** Database name (`<base>-<id>` for a ticket, else the project dev DB). */
  dbName: string;
  /** Suffixed identity for a ticket worktree, else the plain project identity. */
  identity: DevIdentity;
  /** The ticket id when this root is a ticket worktree, else null. */
  ticket: null | string;
}

/** One `git worktree list` entry. */
export interface WorktreeInfo {
  /** Checked-out branch (short name, e.g. `feat/DEV-2200`) or null if detached. */
  branch: null | string;
  /** Absolute worktree path. */
  path: string;
  /** Ticket id from the worktree's `.lt-dev/ticket` marker, if any. */
  ticket: null | string;
}

/** Unsaved-work report for a worktree (used to warn before `lt ticket stop` removes it). */
export interface WorktreeSafety {
  /** Uncommitted, NON-generated changes (porcelain lines) — would be lost on removal. */
  dirtySource: string[];
  /** Commits on the branch not present on any remote (branch is kept, but local-only). */
  unpushed: number;
}

/**
 * Check whether a project's Playwright `global-setup` (if it wipes a DB) would
 * ACCEPT the per-ticket / per-shard test databases that `lt ticket` / `--shard`
 * create (`<base>-<id>-test[-<n>]`). Used by `lt dev doctor` to WARN (never
 * auto-edit) when a bespoke allow-list is too narrow to reset a ticket's test DB.
 *
 * Precise, not heuristic: it extracts the real regex literals from the file and
 * tests them against a SYNTHETIC ticket test-DB name — so an already-safe
 * allow-list (e.g. svl's `…-(?:[a-z0-9-]+-)?test…`) is correctly recognised and
 * a shard-only one (`…-test-\d+`) is correctly flagged.
 */
export function checkGlobalSetupTicketSafe(layout: DevProjectLayout): GlobalSetupCheck {
  const candidates = [
    ...(layout.appDir ? [join(layout.appDir, 'tests', 'global-setup.ts')] : []),
    join(layout.root, 'tests', 'global-setup.ts'),
    join(layout.root, 'global-setup.ts'),
  ];
  const file = candidates.find((f) => existsSync(f)) ?? null;
  if (!file) return { file: null, hasDbReset: false, ticketSafe: true };

  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return { file, hasDbReset: false, ticketSafe: true };
  }
  const hasDbReset = /MONGO_URI|dropDatabase|emptyDatabase|deleteMany|dbNameFromUri/.test(content);
  if (!hasDbReset) return { file, hasDbReset: false, ticketSafe: true };

  // Synthetic per-ticket test DB names derived from the project's dev DB base.
  const base = deriveDbName(layout.apiDir, buildIdentity(layout.root).slug).replace(/-(local|dev)$/i, '');
  const samples = [`${base}-tkprobe-test`, `${base}-tkprobe-test-2`];

  // Test every regex LITERAL in the file against the samples (char classes kept intact).
  const literals = content.match(/\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+\/[a-z]*/gi) ?? [];
  let ticketSafe = false;
  for (const lit of literals) {
    const lastSlash = lit.lastIndexOf('/');
    try {
      const re = new RegExp(lit.slice(1, lastSlash), lit.slice(lastSlash + 1));
      if (samples.some((s) => re.test(s))) {
        ticketSafe = true;
        break;
      }
    } catch {
      /* not a valid regex literal (e.g. a division) — ignore */
    }
  }
  return { file, hasDbReset, ticketSafe };
}

/** Clear the ticket marker (called on teardown). */
export function clearTicketMarker(root: string): void {
  const file = join(root, paths.sessionDir, TICKET_MARKER);
  if (existsSync(file)) {
    try {
      rmSync(file);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Default branch name for a ticket/feature: `feat/<name>` with the human ticket
 * id preserved (case + number), only sanitised for git-ref safety.
 *
 *   "DEV-2200"          → feat/DEV-2200
 *   "checkout refactor" → feat/checkout-refactor
 */
export function defaultTicketBranch(name: string): string {
  const safe = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w.\-/]+/g, '')
    .replace(/^-+|-+$/g, '');
  return `feat/${safe}`;
}

/**
 * Derive the short env id from a ticket id or free feature name.
 *
 *   "DEV-2200"          → "2200"          (ticket pattern → short numeric part)
 *   "ABC-123"           → "123"
 *   "checkout-refactor" → "checkout-refactor" (free name → slug)
 *   (asOverride "cof")  → "cof"           (explicit `--as` wins)
 *
 * The id flows into the slug / URLs / DB, so it is always a clean slug.
 */
export function deriveTicketId(name: string, asOverride?: string): string {
  if (asOverride && asOverride.trim()) return slugify(asOverride);
  const trimmed = name.trim();
  const ticketMatch = trimmed.match(/^[A-Za-z][A-Za-z0-9]*-(\d+)$/);
  if (ticketMatch) return ticketMatch[1];
  return slugify(trimmed);
}

/** Drop a MongoDB database (best-effort, via `mongosh`). Returns true on success. */
export function dropDatabase(dbName: string, mongoBaseUri = 'mongodb://127.0.0.1:27017'): boolean {
  try {
    execFileSync(
      'mongosh',
      [`${mongoBaseUri}/${encodeURIComponent(dbName)}`, '--quiet', '--eval', 'db.dropDatabase()'],
      {
        stdio: 'ignore',
      },
    );
    return true;
  } catch {
    return false;
  }
}

/** True if a local branch with this name already exists. */
export function gitBranchExists(repoDir: string, branch: string): boolean {
  try {
    git(repoDir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** `git fetch <remote>` (so worktrees branch from the freshest base). */
export function gitFetch(repoDir: string, remote = 'origin'): void {
  git(repoDir, ['fetch', remote, '--prune']);
}

/**
 * Resolve the MAIN repository root even when invoked from inside a worktree, so
 * sibling worktrees are always created next to the primary checkout (never
 * nested inside another worktree).
 */
export function gitMainRepoRoot(cwd: string): string {
  // `--git-common-dir` is the SHARED `.git` (same for every worktree); its
  // parent is the main repo root.
  const commonDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return dirname(commonDir);
}

/** List all worktrees of the repo (parsed from `git worktree list --porcelain`). */
export function listWorktrees(repoDir: string): WorktreeInfo[] {
  let out = '';
  try {
    out = git(repoDir, ['worktree', 'list', '--porcelain']);
  } catch {
    return [];
  }
  const result: WorktreeInfo[] = [];
  let current: null | Partial<WorktreeInfo> = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current?.path) result.push(finalizeWorktree(current));
      current = { branch: null, path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (current?.path) result.push(finalizeWorktree(current));
  return result;
}

/**
 * Install dependencies in a freshly-created worktree. Auto-detects the
 * project's package manager from its lockfile (pnpm hard-links from the
 * shared store → fast; npm + yarn install normally). Falls back to pnpm
 * for fresh scaffolds without a lockfile yet.
 */
export function installWorktreeDeps(dir: string): void {
  const pm = pickPackageManager(dir);
  execFileSync(pm.bin, pm.installArgs, { cwd: dir, stdio: 'inherit' });
}


/** Read the ticket id this worktree is tagged with, or null. */
export function readTicketMarker(root: string): null | string {
  const file = join(root, paths.sessionDir, TICKET_MARKER);
  if (!existsSync(file)) return null;
  try {
    const id = readFileSync(file, 'utf8').trim();
    return id || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the dev identity + DB name for a project root, ticket-aware.
 *
 * Order of precedence for the ticket id:
 *   1. an explicit `--ticket <name>` option (raw → {@link deriveTicketId}),
 *   2. the `.lt-dev/ticket` marker in the worktree (already an id),
 *   3. none → the plain project identity (base dev stack).
 *
 * Used by `lt dev up / down / test / status` so all of them treat a ticket
 * worktree identically without duplicating the suffix logic.
 */
export function resolveDevIdentity(layout: DevProjectLayout, options?: { ticket?: unknown }): ResolvedDevIdentity {
  const base = buildIdentity(layout.root);
  const baseDb = deriveDbName(layout.apiDir, base.slug);

  const flag = typeof options?.ticket === 'string' && options.ticket.trim() ? deriveTicketId(options.ticket) : null;
  const ticket = flag ?? readTicketMarker(layout.root);

  if (!ticket) return { dbName: baseDb, identity: base, ticket: null };
  return {
    dbName: deriveTicketDbName(baseDb, ticket),
    identity: buildTicketIdentity(base, ticket),
    ticket,
  };
}

/**
 * Add a worktree for a ticket. Creates the branch from `baseRef` when it does
 * not exist yet, otherwise checks the existing branch out into the worktree.
 */
export function worktreeAdd(repoDir: string, worktreePath: string, branch: string, baseRef: string): void {
  if (gitBranchExists(repoDir, branch)) {
    git(repoDir, ['worktree', 'add', worktreePath, branch]);
  } else {
    git(repoDir, ['worktree', 'add', '-b', branch, worktreePath, baseRef]);
  }
}

/** Framework-generated / ephemeral paths a dev/build run dirties (never real work). */
const GENERATED_PATHS =
  /(^|\/)(\.nuxtrc|\.nuxt|\.nitro|\.output|dist|\.turbo|\.cache|\.eslintcache)(\/|$)|\.tsbuildinfo$/;

/** The three git-tracked configs `lt dev up` self-heals to be env-aware. */
const LT_DEV_MANAGED_CONFIG = /(?:^|\/)(?:config\.env\.ts|nuxt\.config\.ts|playwright\.config\.ts)$/;

/**
 * True when a worktree has uncommitted changes AND every one is auto-discardable
 * (framework-generated OR a pristine lt-dev self-heal patch). Lets `lt ticket
 * stop` force-remove a provisioning-only worktree — e.g. an unmigrated project
 * whose configs `lt dev up` env-aware'd — without `--force` and without ever
 * discarding real developer work.
 */
export function worktreeDirtyOnlyAutoDiscardable(worktreePath: string): boolean {
  const { autoDiscardable, realDirty } = classifyWorktreeDirt(worktreePath);
  return realDirty.length === 0 && autoDiscardable.length > 0;
}

/**
 * True ONLY when a worktree has uncommitted changes AND every one is a
 * framework-generated / ephemeral file (`.nuxtrc`, `.nuxt`, `.output`, …).
 * `nuxt dev` rewrites the tracked `.nuxtrc` on boot, which would otherwise block
 * `git worktree remove`; this lets `lt ticket stop` auto-clean those safely.
 */
export function worktreeDirtyOnlyGenerated(worktreePath: string): boolean {
  const lines = gitStatusPorcelain(worktreePath);
  if (lines.length === 0) return false; // clean → no force needed
  return lines.every((line) => GENERATED_PATHS.test(porcelainPath(line)));
}

/**
 * Compute the sibling worktree path for a ticket: `<parent-of-main-repo>/<slug>-<id>`,
 * so it sits right next to the primary checkout and matches the URL (`<slug>-<id>.localhost`).
 */
export function worktreePathFor(mainRepoRoot: string, slug: string, id: string): string {
  return join(dirname(mainRepoRoot), `${slug}-${id}`);
}

/** Remove a worktree (the branch is kept). */
export function worktreeRemove(repoDir: string, worktreePath: string, force = false): void {
  const args = ['worktree', 'remove', worktreePath];
  if (force) args.push('--force');
  git(repoDir, args);
}

/**
 * Unsaved-work report for a worktree, so `lt ticket stop` can WARN + refuse to
 * delete it before the user has committed AND pushed: `dirtySource` are
 * uncommitted NON-generated changes (lost on removal), `unpushed` are commits on
 * the branch not on any remote (the branch is kept on stop, but local-only).
 */
export function worktreeSafetyReport(worktreePath: string): WorktreeSafety {
  // Only REAL developer work counts as dirtySource — framework-generated files
  // AND pristine lt-dev self-heal patches (config.env.ts/nuxt.config.ts/
  // playwright.config.ts that `lt dev up` env-aware'd) are auto-discardable, so
  // `lt ticket stop` never refuses over them.
  const { realDirty } = classifyWorktreeDirt(worktreePath);
  let unpushed = 0;
  try {
    unpushed = Number(git(worktreePath, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])) || 0;
  } catch {
    /* no remotes / detached HEAD → cannot determine; treat as 0 */
  }
  return { dirtySource: realDirty, unpushed };
}

/** Write the ticket marker that tags a worktree (created by `lt ticket start`). */
export function writeTicketMarker(root: string, id: string): void {
  const dir = join(root, paths.sessionDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, TICKET_MARKER), `${id}\n`, 'utf8');
}

/**
 * Split a worktree's uncommitted changes into "auto-discardable" (framework-
 * generated files + pristine lt-dev self-heal patches) and "real" developer work.
 * `lt ticket stop` may force-remove a worktree whose changes are ALL
 * auto-discardable; anything in `realDirty` blocks removal (work could be lost).
 */
function classifyWorktreeDirt(worktreePath: string): { autoDiscardable: string[]; realDirty: string[] } {
  const autoDiscardable: string[] = [];
  const realDirty: string[] = [];
  for (const line of gitStatusPorcelain(worktreePath)) {
    const p = porcelainPath(line);
    if (GENERATED_PATHS.test(p) || isPristineLtDevPatch(worktreePath, p)) autoDiscardable.push(p);
    else realDirty.push(p);
  }
  return { autoDiscardable, realDirty };
}

function finalizeWorktree(partial: Partial<WorktreeInfo>): WorktreeInfo {
  const path = partial.path ?? '';
  return { branch: partial.branch ?? null, path, ticket: path ? readTicketMarker(path) : null };
}

/** Run a git command in `cwd`, returning trimmed stdout. Throws on non-zero exit. */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * `git status --porcelain` lines, each kept VERBATIM (not trimmed).
 *
 * Crucial: a tracked-but-modified file's porcelain prefix begins with a space
 * (` M path`), so trimming the blob (as the generic `git()` helper does) would
 * eat that leading space and shift `porcelainPath`'s `slice(3)` by one,
 * corrupting the path (`projects/…` → `rojects/…`). Returns [] on error.
 */
function gitStatusPorcelain(cwd: string): string[] {
  let out = '';
  try {
    out = execFileSync('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return out.split(/\r?\n/).filter((l) => l.trim() !== '');
}

/**
 * True when the dirty tracked file at `relPath` (relative to the worktree root)
 * differs from its committed (HEAD) version by EXACTLY the lt-dev self-heal
 * patch — i.e. `lt dev up` env-aware'd a legacy config and the developer made no
 * other edit. Verified by re-deriving: apply the same `autoPatch` to the HEAD
 * blob and compare to the working-tree content. Any extra developer edit makes
 * the two differ → treated as real work (never auto-discarded).
 *
 * Only the three lt-dev-managed configs qualify; everything else returns false.
 */
function isPristineLtDevPatch(worktreePath: string, relPath: string): boolean {
  if (!LT_DEV_MANAGED_CONFIG.test(relPath)) return false;
  let head: string;
  try {
    // NOT the trimming `git()` helper — the trailing newline must survive so the
    // comparison against the (untrimmed) working-tree content is exact.
    head = execFileSync('git', ['-C', worktreePath, 'show', `HEAD:${relPath}`], { encoding: 'utf8' });
  } catch {
    return false; // not tracked at HEAD (e.g. a brand-new file) → never auto-discard
  }
  let current: string;
  try {
    current = readFileSync(join(worktreePath, relPath), 'utf8');
  } catch {
    return false;
  }
  // Re-derive what `lt dev up`'s autoPatch produced from the HEAD blob. autoPatch
  // dispatches by filename suffix, so the temp file must keep the basename.
  const tmp = join(tmpdir(), `lt-dev-verify-${process.pid}-${basename(relPath)}`);
  try {
    writeFileSync(tmp, head, 'utf8');
    autoPatch(tmp);
    return readFileSync(tmp, 'utf8') === current;
  } catch {
    return false;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** Path from a `git status --porcelain` line ("XY <path>" / "XY <old> -> <new>"). */
function porcelainPath(line: string): string {
  return line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() ?? '';
}
