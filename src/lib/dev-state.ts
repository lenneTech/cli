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
 *   - `running` — wrapper PID alive AND the internal port is bound (truly serving)
 *   - `crashed` — wrapper PID alive BUT the port is free (zombie supervisor; the
 *                 inner process died — `lt dev up` restarts just this component)
 *   - `dead`    — no live wrapper PID at all
 */
export type ComponentHealth = 'crashed' | 'dead' | 'running';

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
  /** ISO timestamp of last `up`. */
  lastUsedAt?: string;
  /** Absolute project root. */
  path: string;
  /** Subdomain hostnames (`<sub> → <hostname>.localhost`). */
  subdomains: Record<string, string>;
}

/**
 * Classify a component's true health from its recorded wrapper PID plus whether
 * its internal port is actually bound (caller provides the port probe result,
 * typically from a single {@link import('./dev-process').listenSnapshot} call).
 */
export function classifyComponentHealth(opts: { pid?: number; portBound: boolean }): ComponentHealth {
  const wrapperAlive = typeof opts.pid === 'number' && isPidAlive(opts.pid);
  if (!wrapperAlive) return 'dead';
  return opts.portBound ? 'running' : 'crashed';
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
      return parsed as ProjectsRegistry;
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

/** True if two paths resolve to the same location (normalising symlinks, e.g. /var → /private/var). */
function sameRealPath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
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
