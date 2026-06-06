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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { buildIdentity, buildTicketIdentity, DevIdentity, slugify } from './dev-identity';
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

/** Install dependencies in a freshly-created worktree (pnpm hard-links from the shared store → fast). */
export function pnpmInstall(dir: string): void {
  const pnpmBin = process.env.LT_PNPM_BIN || 'pnpm';
  execFileSync(pnpmBin, ['install'], { cwd: dir, stdio: 'inherit' });
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

/**
 * True ONLY when a worktree has uncommitted changes AND every one is a
 * framework-generated / ephemeral file (`.nuxtrc`, `.nuxt`, `.output`, …).
 * `nuxt dev` rewrites the tracked `.nuxtrc` on boot, which would otherwise block
 * `git worktree remove`; this lets `lt ticket stop` auto-clean those safely.
 */
export function worktreeDirtyOnlyGenerated(worktreePath: string): boolean {
  let out = '';
  try {
    out = git(worktreePath, ['status', '--porcelain', '--untracked-files=all']);
  } catch {
    return false;
  }
  const lines = out.split(/\r?\n/).filter((l) => l.trim());
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
  let status = '';
  try {
    status = git(worktreePath, ['status', '--porcelain', '--untracked-files=all']);
  } catch {
    return { dirtySource: [], unpushed: 0 };
  }
  const dirtySource = status
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .filter((l) => !GENERATED_PATHS.test(porcelainPath(l)));
  let unpushed = 0;
  try {
    unpushed = Number(git(worktreePath, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])) || 0;
  } catch {
    /* no remotes / detached HEAD → cannot determine; treat as 0 */
  }
  return { dirtySource, unpushed };
}

/** Write the ticket marker that tags a worktree (created by `lt ticket start`). */
export function writeTicketMarker(root: string, id: string): void {
  const dir = join(root, paths.sessionDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, TICKET_MARKER), `${id}\n`, 'utf8');
}

function finalizeWorktree(partial: Partial<WorktreeInfo>): WorktreeInfo {
  const path = partial.path ?? '';
  return { branch: partial.branch ?? null, path, ticket: path ? readTicketMarker(path) : null };
}

/** Run a git command in `cwd`, returning trimmed stdout. Throws on non-zero exit. */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Path from a `git status --porcelain` line ("XY <path>" / "XY <old> -> <new>"). */
function porcelainPath(line: string): string {
  return line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() ?? '';
}
