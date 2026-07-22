/**
 * Per-ticket parallel dev environments for `lt dev` (used by the `lt ticket`
 * command group).
 *
 * The model: ONE git repo, N git worktrees — one per ticket/feature — each on
 * its own branch (created fresh from the repo's base branch — see
 * {@link resolveBaseRef} — so tickets are independent), each running its own
 * `lt dev` stack on a SUFFIXED identity:
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
import { autoPatch, canonicaliseBridgeSpan } from './dev-patches';
import { deriveDbName, deriveTestDbName, deriveTicketDbName, DevProjectLayout } from './dev-project';
import { paths, sameRealPath } from './dev-state';

/** Marker file (under `.lt-dev/`) that tags a worktree with its ticket id. */
const TICKET_MARKER = 'ticket';

/** Where ticket databases live. Deliberately loopback-only — never a remote/prod host. */
const MONGO_BASE_URI = 'mongodb://127.0.0.1:27017';

/** Upper bound for a single `mongosh` call, so an unreachable Mongo cannot hang a teardown. */
const MONGOSH_TIMEOUT_MS = 10_000;

/**
 * Ticket ids that would make the ticket's derived database collide with a
 * PROJECT-level database.
 *
 * {@link deriveTicketDbName} and {@link deriveTestDbName} both strip a trailing
 * `-(local|dev)` before appending their own suffix, so these ids round-trip onto
 * the project's own DBs — e.g. project db `imo-local` + ticket id `local` derives
 * back to `imo-local`, and its test db to `imo-test`. Both are the DEVELOPER's
 * databases, not the ticket's. Rejecting the ids at creation keeps the collision
 * from ever existing; {@link isTicketScopedDb} is the second line of defence for
 * environments created before this guard.
 */
const RESERVED_TICKET_IDS = new Set(['ci', 'dev', 'e2e', 'local', 'prod', 'production', 'staging', 'test']);

/** The base ref a ticket branch is created from, and how it was found. */
export interface BaseRefResolution {
  /** The refs probed, in order (a single entry when `--base` was given). */
  candidates: string[];
  /** True when the ref came from an explicit `--base`. */
  explicit: boolean;
  /** The first existing candidate, or null when none of them exists. */
  ref: null | string;
}

/** Why a {@link dropDatabase} call did (not) drop — each needs a different fix from the user. */
export type DropDbOutcome = 'dropped' | 'no-mongosh' | 'unreachable';

/** Outcome of a {@link dropDatabases} batch. */
export interface DropDbResult {
  /** The databases actually dropped (in order). */
  dropped: string[];
  /** Why the batch stopped early, or null when everything was dropped. */
  reason: DropDbOutcome | null;
}

/** Result of the per-project global-setup ticket-safety check (for `lt dev doctor`). */
export interface GlobalSetupCheck {
  /** The global-setup file path, if found. */
  file: null | string;
  /** True if the global-setup actually resets a database. */
  hasDbReset: boolean;
  /** True if its allow-list accepts a per-ticket / per-shard `…-test` DB. */
  ticketSafe: boolean;
}

/** How `--keep-db` was given on the command line (see {@link keepDbFlag}). */
export interface KeepDbFlag {
  /** True when the ticket's databases must be KEPT. */
  keep: boolean;
  /**
   * A positional argument yargs-parser swallowed as the flag's "value" — `--keep-db`
   * takes none, so `lt ticket stop --keep-db 2200` lands the ticket id HERE and leaves
   * `parameters.first` undefined. Null for every well-formed invocation.
   */
  strayValue: null | string;
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

/** Which databases a `lt ticket stop` may drop, and which it refused (see {@link planTicketDbDrop}). */
export interface TicketDropPlan {
  /** Set when the registry slug is owned by a DIFFERENT checkout — its dbName was ignored. */
  foreignEntryPath: null | string;
  /** Candidates that are NOT this ticket's databases — never dropped, surfaced to the user. */
  refused: string[];
  /** Databases that provably belong to this ticket. */
  targets: string[];
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

interface DriverRunResult {
  outcome: 'failed' | 'no-driver' | 'ok';
  stdout: string;
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
  // The API-style per-run scheme (db-lifecycle reporter) manages its own
  // cleanup + naming — nothing for this Playwright-oriented check to judge.
  if (content.includes('db-lifecycle.reporter')) {
    return { file, hasDbReset: true, ticketSafe: true };
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

/**
 * Drop a MongoDB database via `mongosh`.
 *
 * SHAPE IS DELIBERATE — do NOT "optimise" it into a single multi-DB `--eval`:
 * the database name travels in the URI PATH (percent-encoded, so it cannot
 * escape into the host/query and hijack the connection), and `--eval` is a
 * CONSTANT string, so the name is never interpolated into JavaScript. Together
 * with `execFileSync`'s argv form (no shell), that is what makes an arbitrary
 * db name un-injectable. Batching the drops would require building the eval
 * from the names — trading that property away to save one process spawn.
 *
 * Returns WHY it failed, not just that it did: a missing `mongosh` binary and an
 * unreachable Mongo need completely different fixes from the user, and collapsing
 * both into `false` is how a "cleanup" feature ends up silently cleaning nothing.
 */
export function dropDatabase(
  dbName: string,
  mongoBaseUri = MONGO_BASE_URI,
  driverPaths: (null | string | undefined)[] = [],
): DropDbOutcome {
  try {
    execFileSync(
      'mongosh',
      [`${mongoBaseUri}/${encodeURIComponent(dbName)}`, '--quiet', '--eval', 'db.dropDatabase()'],
      // Without a timeout this blocks for as long as mongosh feels like: a Mongo that
      // accepts TCP but never answers leaves the driver's 30s server-selection default
      // to expire — silently, since stdio is ignored. On a default teardown path that
      // is unacceptable, so we impose our own bound.
      { killSignal: 'SIGKILL', stdio: 'ignore', timeout: MONGOSH_TIMEOUT_MS },
    );
    return 'dropped';
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return 'unreachable';
    // mongosh is not installed — a REAL machine state that silently disabled every DB
    // drop for months (ticket DBs piled up because `lt ticket stop` only warned).
    // Fall back to the PROJECT's own `mongodb` driver when the caller provides
    // resolution paths (the API project always depends on it via nest-server).
    const res = runWithProjectDriver(driverPaths, 'await c.db(process.env.LT_MONGO_DB).dropDatabase();', {
      LT_MONGO_DB: dbName,
      LT_MONGO_URI: mongoBaseUri,
    });
    if (res.outcome === 'no-driver') return 'no-mongosh';
    return res.outcome === 'ok' ? 'dropped' : 'unreachable';
  }
}

/**
 * Drop several databases, stopping at the first failure.
 *
 * A failure is never per-database: if `mongosh` is missing it is missing for all of
 * them, and if Mongo is unreachable it is unreachable for all of them. Retrying each
 * name would just multiply the timeout (2 names × 10s of hanging, for one diagnosis).
 */
export function dropDatabases(
  dbNames: string[],
  mongoBaseUri = MONGO_BASE_URI,
  driverPaths: (null | string | undefined)[] = [],
): DropDbResult {
  const dropped: string[] = [];
  for (const db of dbNames) {
    const outcome = dropDatabase(db, mongoBaseUri, driverPaths);
    if (outcome !== 'dropped') return { dropped, reason: outcome };
    dropped.push(db);
  }
  return { dropped, reason: null };
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

/** True if `ref` resolves to a commit in the repo (any ref kind: local, remote, tag, sha). */
export function gitRefExists(repoDir: string, ref: string): boolean {
  try {
    execFileSync('git', ['-C', repoDir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
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

/**
 * True for ticket ids whose derived database would collide with a project-level
 * database (see {@link RESERVED_TICKET_IDS}). `lt ticket start` refuses them, so
 * the collision cannot be created in the first place.
 */
export function isReservedTicketId(id: string): boolean {
  return RESERVED_TICKET_IDS.has(id.trim().toLowerCase());
}

/**
 * True only when `dbName` provably belongs to ticket `ticketId` of the project whose
 * own dev database is `projectDevDb`.
 *
 * This is the LAST gate before an irreversible drop, and it exists because the name
 * being dropped is *derived* (or read from a slug-keyed global registry) rather than
 * observed. Two things can therefore steer it at the wrong database:
 *
 *   • a reserved ticket id (`local`/`dev`/`test`) derives back onto the project's own
 *     dev/test DB — the suffix check alone would happily accept that, because the name
 *     really does look ticket-shaped. Hence the explicit project-DB exclusion FIRST.
 *   • a registry entry under `<slug>-<id>` that in truth belongs to a different
 *     checkout (the registry is global and keyed by slug alone) carries THAT project's
 *     dbName — which will not match this ticket's shape and is rejected here.
 *
 * A derivation that drifts must fail closed: refuse, never guess.
 */
export function isTicketScopedDb(dbName: string, ticketId: string, projectDevDb: string): boolean {
  if (dbName === projectDevDb || dbName === deriveTestDbName(projectDevDb)) return false;
  const base = projectDevDb.replace(/-(local|dev)$/i, '');
  if (dbName === `${base}-${ticketId}` || dbName === `${base}-${ticketId}-test`) return true;
  // Sharded Playwright stacks (`lt dev test --shard N`) derive one DB per shard:
  // `<base>-<id>-test-<n>`. Without this arm they were invisible to the drop plan
  // and orphaned on every sharded ticket test run.
  return new RegExp(`^${escapeRegExpForDb(`${base}-${ticketId}-test-`)}\\d+$`).test(dbName);
}

/**
 * Read the `--keep-db` opt-out. FAIL-CLOSED BY CONSTRUCTION.
 *
 * gluegun parses argv with yargs-parser and declares NO booleans, so the flag does not
 * arrive as `true` in most of the spellings people actually type:
 *
 *   --keep-db          → true      (boolean)
 *   --keep-db=true     → 'true'    (STRING)
 *   --keep-db true     → 'true'    (STRING)
 *   --keep-db 2200     → 2200      (NUMBER — and the ticket id is GONE from positionals)
 *   --no-keep-db       → false     (boolean)
 *
 * A strict `=== true` test reads three of those as "the user did not ask to keep" and
 * destroys the very data they asked to keep. That shape is right for `--force`, where a
 * parse quirk means "don't force" (safe); it is exactly backwards for a flag that
 * PREVENTS destruction.
 *
 * So: the flag's PRESENCE means keep. Only an explicit negation still drops.
 */
export function keepDbFlag(options: Record<string, unknown> = {}): KeepDbFlag {
  const raw = options.keepDb ?? options['keep-db'];
  if (raw === undefined || raw === null) return { keep: false, strayValue: null };
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return { keep: false, strayValue: null };

  // The flag takes no value, so anything that is not an affirmation is a positional
  // yargs-parser swallowed. Hand it back rather than silently losing it.
  const affirmative = raw === true || ['1', 'true', 'yes'].includes(String(raw).toLowerCase());
  return { keep: true, strayValue: affirmative ? null : String(raw) };
}

/**
 * Branches offered when the user has to pick a base ref interactively (no
 * candidate matched). Remote + local branches, most recently committed first,
 * `origin/HEAD` filtered out (it is an alias, not a branch).
 */
export function listBaseRefChoices(repoDir: string, limit = 25): string[] {
  let out = '';
  try {
    out = git(repoDir, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)',
      'refs/remotes',
      'refs/heads',
    ]);
  } catch {
    return [];
  }
  const refs = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.endsWith('/HEAD'));
  return [...new Set(refs)].slice(0, limit);
}

/**
 * List all database names on the local Mongo, or null when that is impossible
 * (mongosh missing / Mongo unreachable).
 *
 * Used to OBSERVE what actually exists instead of deriving it: sharded test DBs
 * (`<base>-<id>-test-<n>`) have an unbounded index, so no static candidate list
 * can cover them. Callers must still gate every observed name through
 * {@link isTicketScopedDb} before dropping — observation widens the candidate
 * set, never the safety rules.
 */
export function listDatabaseNames(
  mongoBaseUri = MONGO_BASE_URI,
  driverPaths: (null | string | undefined)[] = [],
): null | string[] {
  try {
    const out = execFileSync(
      'mongosh',
      [
        `${mongoBaseUri}/admin`,
        '--quiet',
        '--eval',
        'db.adminCommand({ listDatabases: 1, nameOnly: true }).databases.forEach(d => print(d.name))',
      ],
      { killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'], timeout: MONGOSH_TIMEOUT_MS },
    )
      .toString()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return out;
  } catch {
    // Fall back to the project's own `mongodb` driver (see dropDatabase).
    const res = runWithProjectDriver(
      driverPaths,
      "const { databases } = await c.db('admin').admin().listDatabases({ nameOnly: true });" +
        ' databases.forEach((d) => console.log(d.name));',
      { LT_MONGO_URI: mongoBaseUri },
    );
    if (res.outcome !== 'ok') return null;
    return res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
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
 * Decide which databases `lt ticket stop` may drop — pure, so the decision guarding an
 * irreversible action is unit-testable instead of buried in a gluegun `run()` closure.
 *
 * The name to drop is never observed; it is DERIVED, or read from the global registry.
 * Both sources can point at a database the ticket never owned, so every candidate is
 * validated against the ticket's shape and anything that does not match is refused:
 *
 *   • App-only project    → no MongoDB exists at all → nothing to drop.
 *   • Foreign registry    → the registry is keyed by slug alone, so `<slug>-<id>` can be
 *                           a genuinely different project (`myapp` + ticket `admin` vs. a
 *                           real `myapp-admin`). Its `dbName` is that project's — ignore it.
 *   • Reserved ticket id  → `local`/`dev`/`test` derive back onto the PROJECT's own dev or
 *                           test DB. Refused by {@link isTicketScopedDb}.
 */
export function planTicketDbDrop(args: {
  /** False for App-only projects — they have no database (see `normalizeRegistry`). */
  hasApi: boolean;
  /**
   * All database names actually present on the server (from {@link listDatabaseNames}),
   * or null/undefined when listing was impossible. Needed to find sharded test DBs
   * (`<devDb>-test-<n>`) — their shard index is unbounded, so they can only be
   * OBSERVED, never derived. Every observed name still has to pass
   * {@link isTicketScopedDb} below; a listing failure degrades to the derived
   * candidates (previous behavior), it never widens the drop set.
   */
  observedDbNames?: null | string[];
  /** The PROJECT's own dev database, e.g. `imo-local`. */
  projectDevDb: string;
  /** The registry entry found under `<slug>-<id>`, if any. */
  registryEntry?: { dbName?: string; path?: string };
  ticketId: string;
  /** The ticket worktree — an entry is only trusted when it actually points here. */
  worktreePath: string;
}): TicketDropPlan {
  const { hasApi, observedDbNames, projectDevDb, registryEntry, ticketId, worktreePath } = args;
  if (!hasApi) return { foreignEntryPath: null, refused: [], targets: [] };

  const trusted = registryEntry?.path && sameRealPath(registryEntry.path, worktreePath) ? registryEntry : undefined;
  const foreignEntryPath = registryEntry && !trusted ? (registryEntry.path ?? null) : null;

  const devDb = trusted?.dbName ?? deriveTicketDbName(projectDevDb, ticketId);
  const shardCandidates = (observedDbNames ?? []).filter((name) => name.startsWith(`${devDb}-test-`));
  // eslint-disable-next-line perfectionist/sort-sets -- dev DB first is the meaningful (and drop) order
  const candidates = [...new Set([devDb, deriveTestDbName(devDb), ...shardCandidates])];
  const targets = candidates.filter((db) => isTicketScopedDb(db, ticketId, projectDevDb));

  return { foreignEntryPath, refused: candidates.filter((db) => !targets.includes(db)), targets };
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
 * Resolve the ref a fresh ticket branch is created from.
 *
 * An explicit `--base` always wins (and is reported as missing when it does not
 * resolve). Otherwise the repo's base branch is DISCOVERED, because it is not
 * called the same everywhere — `nest-server` uses `develop`, the lt starters use
 * `dev`, GitHub defaults to `main`:
 *
 *   origin/dev → origin/develop → the remote's HEAD → origin/main → origin/master
 *   → the same names as LOCAL branches (repo without a remote)
 *
 * `ref: null` means none of them exists — the caller then asks the user
 * (`lt ticket start`) instead of failing on a hard-coded `origin/dev`.
 */
export function resolveBaseRef(repoDir: string, explicit?: string): BaseRefResolution {
  const wanted = explicit?.trim();
  if (wanted) {
    return {
      candidates: [wanted],
      explicit: true,
      ref: gitRefExists(repoDir, wanted) ? wanted : null,
    };
  }
  const candidates = baseRefCandidates(repoDir);
  return {
    candidates,
    explicit: false,
    ref: candidates.find((ref) => gitRefExists(repoDir, ref)) ?? null,
  };
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

/** Escape a literal database-name fragment for use inside a RegExp. */
function escapeRegExpForDb(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run a CONSTANT driver snippet via `node -e` using the project's own `mongodb`
 * package (nest-server APIs always depend on it). SAME injection-safety doctrine
 * as the mongosh path: the eval string is constant, every variable travels via
 * env — never interpolated into code. `action` receives the connected client as
 * `c` and must be a constant string from THIS module, never caller input.
 */
function runWithProjectDriver(
  driverPaths: (null | string | undefined)[],
  action: string,
  env: Record<string, string>,
): DriverRunResult {
  let driver: null | string = null;
  for (const dir of driverPaths.filter(Boolean)) {
    try {
      driver = require.resolve('mongodb', { paths: [dir] });
      break;
    } catch {
      /* try next path */
    }
  }
  if (!driver) return { outcome: 'no-driver', stdout: '' };
  const script =
    'const { MongoClient } = require(process.env.LT_MONGO_DRIVER);' +
    'MongoClient.connect(process.env.LT_MONGO_URI, { serverSelectionTimeoutMS: 8000 })' +
    `.then(async (c) => { ${action} await c.close(); process.exit(0); })` +
    '.catch(() => process.exit(2));';
  try {
    const stdout = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, ...env, LT_MONGO_DRIVER: driver },
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: MONGOSH_TIMEOUT_MS,
    }).toString();
    return { outcome: 'ok', stdout };
  } catch {
    return { outcome: 'failed', stdout: '' };
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
    // Only meaningful when a remote EXISTS: in a local-only repo (e.g. a fresh
    // `lt fullstack init` without --git-link) "push first" is impossible, and the
    // branch survives worktree removal anyway — counting every commit as
    // "unpushed" would turn the gate into a permanent dead end.
    if (git(worktreePath, ['remote'])) {
      unpushed = Number(git(worktreePath, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])) || 0;
    }
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

/** Branch names a project may use as its integration branch, in preference order. */
const BASE_BRANCH_NAMES = ['dev', 'develop', 'main', 'master'];

/**
 * The refs {@link resolveBaseRef} probes, in order. Remote branches first (a
 * ticket must start from the freshest integration state), the remote's own HEAD
 * ahead of the guessed `main`/`master`, and the local branches last so a repo
 * without a remote still works.
 */
function baseRefCandidates(repoDir: string): string[] {
  const remoteHead = gitRemoteHead(repoDir);
  const ordered = [
    'origin/dev',
    'origin/develop',
    ...(remoteHead ? [remoteHead] : []),
    'origin/main',
    'origin/master',
    ...BASE_BRANCH_NAMES,
  ];
  return ordered.filter((ref, i) => ordered.indexOf(ref) === i); // dedupe, order preserved
}

/**
 * Split a worktree's uncommitted changes into "auto-discardable" (framework-
 * generated files + pristine lt-dev self-heal patches) and "real" developer work.
 * `lt ticket stop` may force-remove a worktree whose changes are ALL
 * auto-discardable; anything in `realDirty` blocks removal (work could be lost).
 */
function classifyWorktreeDirt(worktreePath: string): {
  autoDiscardable: string[];
  realDirty: string[];
} {
  const autoDiscardable: string[] = [];
  const realDirty: string[] = [];
  for (const line of gitStatusPorcelain(worktreePath)) {
    const p = porcelainPath(line);
    if (
      GENERATED_PATHS.test(p) ||
      isPristineLtDevPatch(worktreePath, p) ||
      isPristineLtDevGitignoreAppend(worktreePath, p)
    ) {
      autoDiscardable.push(p);
    } else {
      realDirty.push(p);
    }
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
 * The branch a remote's HEAD points at (`origin/main`, `origin/develop`, …), or
 * null. stderr is swallowed: a repo whose `refs/remotes/<remote>/HEAD` was never
 * set is the normal case here, not an error worth printing.
 */
function gitRemoteHead(repoDir: string, remote = 'origin'): null | string {
  try {
    const out = execFileSync('git', ['-C', repoDir, 'symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
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
    out = execFileSync('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=all'], {
      encoding: 'utf8',
    });
  } catch {
    return [];
  }
  return out.split(/\r?\n/).filter((l) => l.trim() !== '');
}

/**
 * True when the dirty `.gitignore` differs from HEAD by EXACTLY the `.lt-dev/`
 * line that `lt dev up` appends on every start (see `addToGitignore`). Older
 * templates ship without that line, so EVERY ticket worktree's first `up` dirties
 * `.gitignore` — and without this check every `lt ticket stop` then refuses over
 * a machine-made change. Any other edit (removed lines, additional added lines)
 * keeps it real work.
 */
function isPristineLtDevGitignoreAppend(worktreePath: string, relPath: string): boolean {
  if (relPath !== '.gitignore') return false;
  let head = '';
  try {
    head = execFileSync('git', ['-C', worktreePath, 'show', 'HEAD:.gitignore'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return false; // not tracked in HEAD → a NEW .gitignore is real work
  }
  let work = '';
  try {
    work = readFileSync(join(worktreePath, '.gitignore'), 'utf8');
  } catch {
    return false; // deleted → real change
  }
  const norm = (s: string) =>
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  const headLines = norm(head);
  const workLines = norm(work);
  const removed = headLines.filter((l) => !workLines.includes(l));
  const added = workLines.filter((l) => !headLines.includes(l));
  return removed.length === 0 && added.length > 0 && added.every((l) => l === '.lt-dev/');
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
    head = execFileSync('git', ['-C', worktreePath, 'show', `HEAD:${relPath}`], {
      encoding: 'utf8',
    });
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
    const derived = readFileSync(tmp, 'utf8');
    if (derived === current) return true;
    // The patcher deliberately lets the consumer's formatter restyle the
    // injected `lt-dev:bridge` block (quote style, wrapping) without rewriting
    // it — so a byte-exact comparison would classify a merely reformatted
    // playwright.config.ts as real developer work and make `lt ticket stop`
    // refuse to remove the worktree. Compare the bridge span in its canonical
    // form; everything OUTSIDE the markers stays byte-exact, so genuine edits
    // are still never auto-discarded.
    return canonicaliseBridgeSpan(derived) === canonicaliseBridgeSpan(current);
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
