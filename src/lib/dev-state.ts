/**
 * State persistence for `lt dev`.
 *
 * Two stores:
 * - Central registry at `~/.lenneTech/projects.json` — index of all
 *   known projects, used by `lt dev status --all`, the Claude Code
 *   plugin hook, and conflict detection.
 * - Per-project state at `<root>/.lt-dev/state.json` — PIDs of the
 *   currently running `lt dev up` session.
 *
 * Both files are JSON, atomically written, and schema-versioned.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/**
 * Health of a single supervised dev component (api or app).
 *
 * `lt dev` starts each component as a detached `pnpm start` / `pnpm dev` wrapper
 * and records THAT wrapper's PID in the session. But the wrapper is the top of a
 * chain — e.g. `pnpm start` → `sh -c "migrate:up && start:local"` → `pnpm` →
 * `nodemon` → `ts-node src/main.ts` — and when the inner ts-node process crashes
 * (a known ts-node-under-load instability), nodemon survives and prints
 * "waiting for file changes". The recorded wrapper PID is therefore still alive
 * even though nothing listens on the internal port. Liveness needs BOTH signals:
 *
 *   - `running`  — wrapper PID alive AND the internal port is bound (truly serving)
 *   - `starting` — wrapper PID alive, port not bound YET, but still within the
 *                  startup grace window after `lt dev up`. A component (esp. the
 *                  API: swc compile + Mongo connect + route registration) can take
 *                  15-30s+ to bind its port; during that window "port free" means
 *                  BOOTING, not crashed. Reporting it as `crashed` was a
 *                  false-positive that made users restart a healthy, still-booting
 *                  stack.
 *   - `crashed`  — wrapper PID alive BUT the port is free AND the grace window has
 *                  elapsed (zombie supervisor; the inner process died —
 *                  `lt dev up` restarts just this component)
 *   - `dead`     — no live wrapper PID at all
 */
export type ComponentHealth = 'crashed' | 'dead' | 'running' | 'starting';

/**
 * How long after `lt dev up` a not-yet-bound-but-PID-alive component is treated
 * as `starting` (booting) rather than `crashed`. Covers the slow API boot
 * (compile + Mongo + Better Auth + AI tools + migrations) with headroom.
 */
export const STARTUP_GRACE_MS = 60_000;

/** One component's presence + health, used by {@link partitionComponentStates}. */
export interface ComponentPresence {
  /** Classified health of the component. */
  health: ComponentHealth;
  /** Component label, e.g. `'api'` / `'app'`. */
  name: string;
  /** Whether the project actually has this component (registered port or recorded PID). */
  present: boolean;
}

/** Per-project session state (PIDs of detached processes). */
export interface DevSessionState {
  pids: { api?: number; app?: number };
  startedAt: string;
}

/** Central registry stored at `~/.lenneTech/projects.json`. */
export interface ProjectsRegistry {
  projects: Record<string, ProjectsRegistryEntry>;
  version: 1;
}

/** One project's persistent metadata. */
export interface ProjectsRegistryEntry {
  /** Database name, when known. */
  dbName?: string;
  /** Internal ports (Caddy upstreams) — frozen on first `up`. */
  internalPorts: { api?: number; app?: number };
  /**
   * Databases the user explicitly kept via `lt ticket stop --keep-db`, recorded on
   * the MAIN project's entry (the ticket's own entry is deleted on stop). The
   * orphan-DB sweep (`lt dev prune` / `lt dev up`) must never collect these.
   */
  keptDbs?: string[];
  /** ISO timestamp of last `up`. */
  lastUsedAt?: string;
  /** Absolute project root. */
  path: string;
  /** Subdomain hostnames (`<sub> → <hostname>.localhost`). */
  subdomains: Record<string, string>;
}

/**
 * Aggregate a stack's per-component health into a single summary state for the
 * `lt dev status --all` glyph. Precedence mirrors the honest-liveness rules:
 *   - `running`  — every present component is serving
 *   - `degraded` — at least one running AND at least one not (mixed up/down)
 *   - `starting` — none running yet, but at least one still booting (grace window)
 *   - `crashed`  — none running/booting, but at least one crashed (supervisor up, port free)
 *   - `stopped`  — nothing present, or all dead
 */
export type StackHealth = 'crashed' | 'degraded' | 'running' | 'starting' | 'stopped';

/**
 * Classify a component's true health from its recorded wrapper PID plus whether
 * its internal port is actually bound (caller provides the port probe result,
 * typically from a single {@link import('./dev-process').listenSnapshot} call).
 *
 * When `startedAt` is supplied, a PID-alive-but-port-unbound component is reported
 * as `starting` (booting) rather than `crashed` for the first {@link STARTUP_GRACE_MS}
 * after `lt dev up` — see the {@link ComponentHealth} doc block for the full state
 * model and the false-positive it prevents.
 */
export function classifyComponentHealth(opts: {
  pid?: number;
  portBound: boolean;
  /** Session start (ISO). When given, a not-yet-bound component within the grace window is `starting`. */
  startedAt?: string;
  /** Override the startup grace window (ms). Defaults to {@link STARTUP_GRACE_MS}. */
  startupGraceMs?: number;
}): ComponentHealth {
  const wrapperAlive = typeof opts.pid === 'number' && isPidAlive(opts.pid);
  if (!wrapperAlive) return 'dead';
  if (opts.portBound) return 'running';
  // Wrapper alive but the port is not bound. Within the startup grace window after
  // `lt dev up` this is a still-BOOTING component, not a crash (avoids the
  // false-positive that told users to restart a healthy, still-booting stack).
  const graceMs = opts.startupGraceMs ?? STARTUP_GRACE_MS;
  if (opts.startedAt) {
    const ageMs = Date.now() - new Date(opts.startedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < graceMs) return 'starting';
  }
  return 'crashed';
}

/**
 * Split present components into those still booting (`starting`) vs. genuinely
 * down (present, not running, not starting). A `starting` component is booting,
 * not down — it must NEVER appear in the "restart the down half" hint, otherwise
 * the user is told to restart a healthy, still-booting stack.
 */
export function partitionComponentStates(components: ComponentPresence[]): { down: string[]; starting: string[] } {
  const starting = components.filter((c) => c.present && c.health === 'starting').map((c) => c.name);
  const down = components
    .filter((c) => c.present && c.health !== 'running' && c.health !== 'starting')
    .map((c) => c.name);
  return { down, starting };
}

/** See {@link StackHealth} for the precedence rules this implements. */
export function summarizeStackHealth(components: ComponentHealth[]): StackHealth {
  if (components.length === 0) return 'stopped';
  if (components.every((h) => h === 'running')) return 'running';
  if (components.some((h) => h === 'running')) return 'degraded';
  if (components.some((h) => h === 'starting')) return 'starting';
  if (components.some((h) => h === 'crashed')) return 'crashed';
  return 'stopped';
}

const REGISTRY_PATH = process.env.LT_DEV_REGISTRY_PATH || join(homedir(), '.lenneTech', 'projects.json');
const SESSION_DIR = '.lt-dev';
const SESSION_FILE = 'state.json';
/** Session file for the ephemeral `lt dev test` stack (runs parallel to the dev session). */
export const TEST_SESSION_FILE = 'state.test.json';

/** Result of {@link detectSlugConflict} — another checkout already owns this slug. */
export interface SlugConflict {
  /** The registered path that differs from the current checkout. */
  otherPath: string;
  /** True if that other checkout currently has a live `lt dev up` session. */
  otherSessionAlive: boolean;
}

/**
 * Allocate a free internal port for a Caddy upstream.
 *
 * Strategy: try sequential ports starting from `start`, skipping any
 * that are already in use. The range 4000-4999 is conventional for
 * lt dev internal ports — well above the deprecated 3000/3001 range
 * and safely below most reserved/system ranges.
 */
export function allocateInternalPort(start: number, taken: Set<number>): number {
  for (let p = start; p < start + 1000; p++) {
    if (!taken.has(p)) return p;
  }
  throw new Error(`No free internal port in range [${start}, ${start + 1000})`);
}

/** Remove session state file (called by `lt dev down`). */
export function clearSession(root: string, sessionFile: string = SESSION_FILE): void {
  const file = join(root, SESSION_DIR, sessionFile);
  if (existsSync(file)) {
    try {
      rmSync(file);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Detect when `slug` is registered to a DIFFERENT checkout than `root`. Two
 * clones of the same project share a package.json "name" → the same slug → the
 * same Caddy block / internal ports / database, so running both via `lt dev`
 * collides (and one's `lt dev down` can unroute the other). Returns null when
 * there is no conflict (no registry entry, or the entry belongs to THIS checkout).
 */
export function detectSlugConflict(slug: string, root: string): null | SlugConflict {
  const entry = loadRegistry().projects[slug];
  if (!entry?.path || sameRealPath(entry.path, root)) return null;
  const session = loadSession(entry.path);
  const otherSessionAlive =
    !!session && [session.pids.api, session.pids.app].some((p) => typeof p === 'number' && isPidAlive(p));
  return { otherPath: entry.path, otherSessionAlive };
}

/** Check whether a process with the given PID is currently alive. */
export function isPidAlive(pid: number): boolean {
  if (!isValidPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Validate a PID — positive integer, within plausible range. */
export function isValidPid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid < 4_194_304;
}

/** Load the central registry; returns an empty one if missing or unreadable. */
export function loadRegistry(): ProjectsRegistry {
  if (!existsSync(REGISTRY_PATH)) return { projects: {}, version: 1 };
  try {
    const parsed = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.version === 1 && typeof parsed.projects === 'object') {
      return normalizeRegistry(parsed as ProjectsRegistry);
    }
  } catch {
    /* fall through */
  }
  return { projects: {}, version: 1 };
}

/** Load session state for a project root. */
export function loadSession(root: string, sessionFile: string = SESSION_FILE): DevSessionState | null {
  const file = join(root, SESSION_DIR, sessionFile);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.pids === 'object' &&
      typeof parsed.startedAt === 'string'
    ) {
      // Validate PIDs
      const pids: { api?: number; app?: number } = {};
      if (isValidPid(parsed.pids.api)) pids.api = parsed.pids.api;
      if (isValidPid(parsed.pids.app)) pids.app = parsed.pids.app;
      return { pids, startedAt: parsed.startedAt };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** True if two paths resolve to the same location (normalising symlinks, e.g. /var → /private/var). */
export function sameRealPath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

/** Atomically persist the registry. */
export function saveRegistry(reg: ProjectsRegistry): void {
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  const tmp = `${REGISTRY_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2), 'utf8');
  // rename is atomic on POSIX
  writeFileSync(REGISTRY_PATH, readFileSync(tmp, 'utf8'), 'utf8');
  try {
    rmSync(tmp);
  } catch {
    /* best-effort */
  }
}

/** Persist session state for a project root. */
export function saveSession(root: string, state: DevSessionState, sessionFile: string = SESSION_FILE): void {
  const dir = join(root, SESSION_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, sessionFile), JSON.stringify(state, null, 2), 'utf8');
}

/** Collect all internal ports already claimed across the registry. */
export function takenInternalPorts(reg: ProjectsRegistry, excludeSlug?: string): Set<number> {
  const ports = new Set<number>();
  for (const [slug, entry] of Object.entries(reg.projects)) {
    if (slug === excludeSlug) continue;
    if (entry.internalPorts.api) ports.add(entry.internalPorts.api);
    if (entry.internalPorts.app) ports.add(entry.internalPorts.app);
  }
  return ports;
}

/**
 * Drop a `dbName` from any entry that has no `api` subdomain. An App-only
 * project has no database, yet older registries (written before `lt dev up`
 * stopped persisting one for App-only stacks) still carry a derived name.
 * Normalizing once on load lets every reader test `entry.dbName` alone,
 * instead of repeating `entry.dbName && entry.subdomains.api` at each display.
 */
function normalizeRegistry(reg: ProjectsRegistry): ProjectsRegistry {
  for (const entry of Object.values(reg.projects)) {
    if (entry?.dbName && !entry.subdomains?.api) {
      delete entry.dbName;
    }
  }
  return reg;
}

const LOCK_PATH = `${REGISTRY_PATH}.lock`;

/**
 * Run `fn` while holding an EXCLUSIVE lock on the registry, so concurrent
 * `lt dev` invocations — e.g. two parallel `lt dev test` in different ticket
 * worktrees — cannot read-modify-write the registry, or allocate the SAME
 * internal ports, at the same time. (Without this, two simultaneous test runs
 * both read the registry before either saves, both pick the same free ports,
 * and the second server fails to bind — the port-allocation race.)
 *
 * The lock is a single atomically-created lock file (`openSync(..,'wx')`); a
 * stale lock left by a crashed process (older than `staleMs`) is reclaimed.
 * Keep `fn` SHORT — allocation + reservation only, NEVER across a build/spawn.
 */
export async function withRegistryLock<T>(
  fn: () => Promise<T> | T,
  opts: { staleMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const staleMs = opts.staleMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const start = Date.now();
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  let fd: null | number = null;
  while (fd === null) {
    try {
      fd = openSync(LOCK_PATH, 'wx'); // atomic exclusive create — throws if held
    } catch {
      try {
        if (Date.now() - statSync(LOCK_PATH).mtimeMs > staleMs) unlinkSync(LOCK_PATH); // reclaim a crashed holder
      } catch {
        /* lock vanished between calls — just retry */
      }
      if (Date.now() - start > timeoutMs) throw new Error(`registry lock busy for >${timeoutMs}ms (${LOCK_PATH})`);
      await delay(40 + Math.floor(Math.random() * 60)); // jittered backoff
    }
  }
  try {
    return await fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(LOCK_PATH);
    } catch {
      /* ignore */
    }
  }
}

/** Promise-based delay for the lock retry loop. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Path constants exported for tests + status displays. */
export const paths = {
  registry: REGISTRY_PATH,
  sessionDir: SESSION_DIR,
  sessionFile: SESSION_FILE,
};
