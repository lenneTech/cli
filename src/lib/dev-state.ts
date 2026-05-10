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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

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

const REGISTRY_PATH = process.env.LT_DEV_REGISTRY_PATH || join(homedir(), '.lenneTech', 'projects.json');
const SESSION_DIR = '.lt-dev';
const SESSION_FILE = 'state.json';

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
export function clearSession(root: string): void {
  const file = join(root, SESSION_DIR, SESSION_FILE);
  if (existsSync(file)) {
    try {
      rmSync(file);
    } catch {
      /* best-effort */
    }
  }
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
export function loadSession(root: string): DevSessionState | null {
  const file = join(root, SESSION_DIR, SESSION_FILE);
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
export function saveSession(root: string, state: DevSessionState): void {
  const dir = join(root, SESSION_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SESSION_FILE), JSON.stringify(state, null, 2), 'utf8');
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

/** Path constants exported for tests + status displays. */
export const paths = {
  registry: REGISTRY_PATH,
  sessionDir: SESSION_DIR,
  sessionFile: SESSION_FILE,
};
