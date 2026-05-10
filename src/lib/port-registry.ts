/**
 * Port registry helpers for `lt local` and `lt ports`.
 *
 * Provides:
 * - Deterministic slot allocation from a project slug (hash-based, reproducible across machines)
 * - Persistent registry at ~/.lenneTech/ports.json
 * - Live port introspection via `lsof` (single-call snapshot for batch checks)
 * - Process state tracking under <project>/.lt-local/state.json
 */
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/** Lowest API port: slot 0 maps to 3000/3001, slot 1 to 3010/3011, … */
export const SLOT_BASE_API = 3000;
/** Distance between two adjacent slots' API ports. */
export const SLOT_STEP = 10;
/** Number of slots [0..SLOT_MAX). API range = [SLOT_BASE_API, SLOT_BASE_API + SLOT_MAX*SLOT_STEP). */
export const SLOT_MAX = 90;

/** Highest port (exclusive) covered by the slot range. Useful for live-port sweeps. */
export const SLOT_PORT_RANGE_END = SLOT_BASE_API + SLOT_MAX * SLOT_STEP;

/** State of the running processes started by `lt local up`. Stored in <project>/.lt-local/state.json. */
export interface LocalState {
  /** Spawned process IDs. */
  pids: { api?: number; app?: number };
  /** Active ports, mirrored from registry for convenience. */
  ports: { api: number; app: number };
  /** ISO timestamp when up was issued. */
  startedAt: string;
}

/** Persisted JSON shape at `~/.lenneTech/ports.json`. */
export interface PortRegistry {
  /** Map projectName → entry. */
  projects: Record<string, PortRegistryEntry>;
  /** Schema version. */
  version: 1;
}

/** Project entry in the central registry. */
export interface PortRegistryEntry {
  /** Optional: dbName for nest-server (used as MongoDB database name). */
  dbName?: string;
  /** ISO timestamp of last `lt local up`. */
  lastUsedAt?: string;
  /** Absolute path to the project root (workspace root for monorepos). */
  path: string;
  /** Allocated API/App port pair. */
  ports: { api: number; app: number };
  /** Slot index (0..89), API = 3000 + slot * 10. */
  slot: number;
}

/** All currently allocated slots in the registry. */
export function allocatedSlots(registry: PortRegistry): Set<number> {
  return new Set(Object.values(registry.projects).map((p) => p.slot));
}

/**
 * Allocate a slot for a project. Returns deterministic slot from slug if free,
 * otherwise scans linearly until a free slot is found. Throws if all are taken.
 *
 * The linear scan loops `i in [1, SLOT_MAX)` (not `<=`) because `i = 0` is the
 * preferred slot already checked in the fast path above.
 */
export function allocateSlot(slug: string, registry: PortRegistry): number {
  const taken = allocatedSlots(registry);
  const preferred = slotFromSlug(slug);
  if (!taken.has(preferred)) {
    return preferred;
  }
  for (let i = 1; i < SLOT_MAX; i++) {
    const candidate = (preferred + i) % SLOT_MAX;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('No free port slot available (all 90 slots are taken).');
}

/**
 * Check via `lsof` whether a single TCP port is currently bound by a LISTEN socket.
 *
 * For multi-port checks prefer {@link listenSnapshot} — it issues a single `lsof`
 * call instead of one per port (~50ms vs ~50ms × N).
 *
 * Note: `-iTCP:<port>` selects connections by *service port* — both LISTEN
 * sockets and remote endpoints. We filter explicitly to LISTEN via
 * `-sTCP:LISTEN` AND post-filter the NAME column for `*:<port>` /
 * `<addr>:<port>` (LISTEN) so outgoing connections whose remote port is
 * `<port>` don't trigger a false positive.
 *
 * Returns null if lsof is unavailable.
 */
export async function checkPortInUse(port: number): Promise<null | { command?: string; inUse: boolean; pid?: number }> {
  return new Promise((resolve) => {
    const child = spawn('lsof', ['-iTCP', `-sTCP:LISTEN`, '-nP', `-iTCP:${port}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout?.on('data', (chunk) => (out += chunk.toString()));
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const lines = out.trim().split('\n').slice(1); // skip header
      const portRe = new RegExp(`:${port}\\s+\\(LISTEN\\)\\s*$`);
      const match = lines.find((l) => portRe.test(l));
      if (!match) {
        resolve({ inUse: false });
        return;
      }
      const cols = match.split(/\s+/);
      resolve({ command: cols[0], inUse: true, pid: Number(cols[1]) });
    });
  });
}

/** Reset state file to an empty record. Called by `lt local down` after stopping processes. */
export function clearLocalState(projectPath: string): void {
  const path = localStatePath(projectPath);
  if (existsSync(path)) {
    writeFileSync(path, `${JSON.stringify({ pids: {}, ports: { api: 0, app: 0 }, startedAt: '' }, null, 2)}\n`, 'utf8');
  }
}

/**
 * Check whether a PID is still alive without sending any signal.
 * `process.kill(pid, 0)` performs a permission check; ESRCH means dead.
 *
 * Refuses non-positive / non-integer PIDs to prevent accidental probes
 * of process groups (negative PID) or every user-owned process (PID 0/-1).
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Validate a value parsed from `state.json` as a plausible PID.
 *
 * Accepts: positive integer in [100, 2^31 - 1] or undefined.
 * The lower bound 100 excludes init / kernel / login PIDs that should
 * never be the result of a `pnpm start` spawn.
 */
export function isValidPid(value: unknown): value is number | undefined {
  if (value === undefined) return true;
  if (typeof value !== 'number') return false;
  return Number.isInteger(value) && value >= 100 && value <= 0x7fffffff;
}

/**
 * One-shot listener snapshot for an arbitrary set of ports.
 *
 * Issues a single `lsof -iTCP -sTCP:LISTEN -nP` call and filters in memory.
 * ~50ms total regardless of port count, vs ~50ms × N for sequential
 * {@link checkPortInUse} calls.
 *
 * Returns an empty Map if `lsof` is unavailable.
 */
export async function listenSnapshot(
  ports: Iterable<number>,
): Promise<Map<number, { command?: string; pid?: number }>> {
  return new Promise((resolve) => {
    const child = spawn('lsof', ['-iTCP', '-sTCP:LISTEN', '-nP'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (chunk) => (out += chunk.toString()));
    child.on('error', () => resolve(new Map()));
    child.on('close', () => {
      const wanted = new Set(ports);
      const result = new Map<number, { command?: string; pid?: number }>();
      const lines = out.trim().split('\n').slice(1);
      const re = /:(\d+)\s+\(LISTEN\)\s*$/;
      for (const line of lines) {
        const m = re.exec(line);
        if (!m) continue;
        const port = Number(m[1]);
        if (!wanted.has(port)) continue;
        if (result.has(port)) continue; // first hit wins (IPv4 before IPv6)
        const cols = line.split(/\s+/);
        result.set(port, { command: cols[0], pid: Number(cols[1]) });
      }
      resolve(result);
    });
  });
}

/**
 * Load the local state JSON for a project.
 *
 * Returns null when the file is missing, unreadable, malformed, or contains
 * structurally invalid data (see {@link isValidPid}). The schema validation
 * here is the authoritative gate: it prevents `process.kill(-pid, …)` in
 * `lt local down` from receiving anything but a plausible PID we ourselves
 * could have written.
 */
export function loadLocalState(projectPath: string): LocalState | null {
  const path = localStatePath(projectPath);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const pids = obj.pids as Record<string, unknown> | undefined;
    const ports = obj.ports as Record<string, unknown> | undefined;
    if (!pids || typeof pids !== 'object' || !ports || typeof ports !== 'object') return null;
    if (!isValidPid(pids.api) || !isValidPid(pids.app)) return null;
    if (typeof ports.api !== 'number' || typeof ports.app !== 'number') return null;
    if (typeof obj.startedAt !== 'string') return null;
    return {
      pids: { api: pids.api as number | undefined, app: pids.app as number | undefined },
      ports: { api: ports.api, app: ports.app },
      startedAt: obj.startedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Load registry; returns empty if missing or corrupt.
 *
 * Prints a warning when a corrupt or schema-incompatible file is encountered
 * so the user notices the silent reset rather than discovering stale port
 * allocations later.
 */
export function loadRegistry(): PortRegistry {
  const path = registryPath();
  if (!existsSync(path)) {
    return { projects: {}, version: 1 };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed?.projects !== 'object') {
      console.warn(`[lt] ports.json has wrong schema (got version=${parsed?.version}); starting with empty registry.`);
      return { projects: {}, version: 1 };
    }
    return parsed as PortRegistry;
  } catch (e) {
    console.warn(`[lt] ports.json was unreadable (${(e as Error).message}); starting with empty registry.`);
    return { projects: {}, version: 1 };
  }
}

/** Path to the local state file inside a project. */
export function localStatePath(projectPath: string): string {
  return join(projectPath, '.lt-local', 'state.json');
}

/** Convert a slot to its API+App port pair. */
export function portsForSlot(slot: number): { api: number; app: number } {
  const api = SLOT_BASE_API + slot * SLOT_STEP;
  return { api, app: api + 1 };
}

/** Convert any project path → a stable slug (basename, lowercase, alpha-num + dashes). */
export function projectSlug(projectPath: string): string {
  const base = projectPath.replace(/\/+$/, '').split('/').pop() || 'project';
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Path to the central registry.
 *
 * Honors `LT_PORTS_REGISTRY_PATH` for tests / non-default workspaces;
 * falls back to `~/.lenneTech/ports.json`.
 */
export function registryPath(): string {
  return process.env.LT_PORTS_REGISTRY_PATH || join(homedir(), '.lenneTech', 'ports.json');
}

/** Persist local state to <project>/.lt-local/state.json (creates the parent directory if needed). */
export function saveLocalState(projectPath: string, state: LocalState): void {
  const path = localStatePath(projectPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Save registry, creating parent directory if needed. */
export function saveRegistry(registry: PortRegistry): void {
  const path = registryPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

/**
 * Deterministic slot from project slug — same slug yields the same slot on every machine.
 * Uses the lower 32 bits of FNV-1a then modulo SLOT_MAX.
 */
export function slotFromSlug(slug: string): number {
  let hash = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < slug.length; i++) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash | 0) % SLOT_MAX;
}
