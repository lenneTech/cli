/**
 * Process + port helpers for `lt dev`.
 *
 * - `spawnDetached`: detached child whose stdout/stderr go to a log file.
 *   The Claude Code session does NOT block waiting for it, and `lt dev down`
 *   can SIGTERM the entire process group via `process.kill(-pid, …)`.
 * - `probePorts`: which of a set of ports has a listener (a TCP connect, so it
 *   answers on every platform) and — where the platform can say — who holds it.
 */
import { ChildProcess, spawn } from 'child_process';
import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync } from 'fs';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { Socket } from 'net';
import { dirname } from 'path';

import { isPidAlive, isValidPid } from './dev-state';
import { isWindows, spawnCmd } from './platform';

/**
 * Who is bound to each of `ports`, and whether that could be established at all.
 *
 * Two questions, deliberately separated, because they have different failure
 * modes and different consumers:
 *
 * - **`bound`** — "is something listening?" Answered by a TCP connect to
 *   127.0.0.1 from Node itself. No external tool, identical on every platform,
 *   and it cannot fail open: a connect either succeeds or it does not.
 * - **`owners`** — "which process?" Needs a tool (`lsof`, `netstat`), so it can
 *   be unavailable. Only three call sites care: the two "port already in use by
 *   X" messages and `reclaimPort`, which KILLS the pid it finds.
 *
 * The predecessor answered both from one `lsof` call and returned an EMPTY MAP
 * when lsof was missing — indistinguishable from "nothing is bound". Every
 * component then classified as `crashed` and `lt dev up` restarted a perfectly
 * healthy stack; `reclaimPort` silently reclaimed nothing and the respawn landed
 * on an occupied port. `ownersUnavailable` exists so a caller can say "I could
 * not tell" instead of acting on an absence of evidence.
 */
/** stdout of a command, or null when it could not run at all. */
export type CaptureStdout = (command: string, args: string[]) => Promise<null | string>;

export interface PortProbe {
  /** Ports with a listener. Reliable on every platform. */
  bound: Set<number>;
  /** Owning process per bound port, where the platform could name it. */
  owners: Map<number, { command: string; pid: number }>;
  /** True when the owner lookup could not run — NOT "no owners found". */
  ownersUnavailable: boolean;
}

/**
 * Injection points, so both owner-lookup branches — and the "no tool available"
 * path — stay assertable from any host. A branch only the other platform runs is
 * an unchecked branch; the same reasoning as `platform.ts`.
 */
export interface PortProbeOptions {
  /** Default: spawn the command and collect stdout. */
  capture?: CaptureStdout;
  /** Default: `process.platform`. */
  platform?: NodeJS.Platform;
}

export interface RotateResult {
  /** Path the previous log was moved to (only set when `rotated`). */
  archivePath?: string;
  /** Size in bytes of the previous log before rotation (only set when `rotated`). */
  previousSize?: number;
  rotated: boolean;
}

/** Options for `runChildInherit` — synchronous child with inherited stdio. */
export interface RunChildOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}


export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFile: string;
}

/**
 * How a detached child is actually launched on this platform.
 *
 * POSIX raises the soft file-descriptor limit before exec-ing the real command.
 * macOS's default soft RLIMIT_NOFILE is 256 (launchd/system default), inherited
 * by the terminal that runs `lt dev up` and therefore by these detached children
 * — it is NOT a consequence of the lt-dev LaunchAgent (which runs only Caddy).
 * The dev file-watcher (nest/nuxt → chokidar) exhausts a soft-256 limit on a
 * monorepo → intermittent "EMFILE: too many open files, watch" crashes on boot
 * that force a manual `lt dev up`. Hence `sh -c "ulimit …; exec …"`:
 *   - `exec` replaces the shell IN PLACE → the recorded PID and the detached
 *     process group are still the real process (PID tracking + group-kill in
 *     `terminateProcessGroup` keep working).
 *   - `"$0" "$@"` pass cmd + args verbatim — no shell-quoting / injection.
 *   - the cascade tries a high limit first, falling back on machines with a
 *     lower `kern.maxfilesperproc`; `2>/dev/null` keeps it best-effort.
 *
 * Windows gets the command directly. There is no `/bin/sh` to run the wrapper —
 * spawning it fails outright — and no RLIMIT_NOFILE for `ulimit` to raise, so
 * the wrapper has nothing to offer there even in principle.
 *
 * Note for the POSIX path: because `spawn('/bin/sh', …)` almost always succeeds,
 * a bogus `cmd` does not surface as `pid === undefined` — the inner `exec` fails
 * (exit 127) a few ms later. Callers briefly record a live-then-dead PID, which
 * `classifyComponentHealth` reaps as `dead`/`crashed` on the next status/up. We
 * deliberately don't watch for that here: a detached, unref'd child's 127 exit is
 * racy to observe, and callers must be self-correcting against real crashes anyway.
 */
export function detachedSpawnCommand(
  cmd: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { args: string[]; command: string } {
  if (platform === 'win32') return { args, command: cmd };
  const raiseFdLimit = 'ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true';
  return { args: ['-c', `${raiseFdLimit}; exec "$0" "$@"`, cmd, ...args], command: '/bin/sh' };
}

/**
 * HTTP status of `url`, or null when the request could not be made at all.
 *
 * Node's own client rather than `curl`. That removes three separate hazards at
 * once, all of which were live:
 *
 * - **`curl -o /dev/null` fails on Windows.** `/dev/null` is a file path there,
 *   not the null device (`NUL` is), so curl exits **23 — "client returned ERROR
 *   on write"** *after* a perfectly successful request. Any caller reading the
 *   exit code concluded the service was down. That is exactly what made
 *   `lt dev up` refuse with "caddy daemon is not running" against a Caddy that
 *   was running and answering 200.
 * - **`curl` is an external dependency** we do not need.
 * - a spawn per probe, where a socket does.
 *
 * TLS verification is off for https URLs, matching the `-k` this replaces: the
 * targets are local Caddy vhosts with a private CA.
 */
export function httpStatus(url: string, timeoutMs = 2000): Promise<null | number> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: null | number): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = client(url, { rejectUnauthorized: false, timeout: timeoutMs }, (response) => {
        // The body is irrelevant; draining it lets the socket close promptly.
        response.resume();
        done(response.statusCode ?? null);
      });
      request.on('timeout', () => {
        request.destroy();
        done(null);
      });
      request.on('error', () => done(null));
      request.end();
    } catch {
      done(null);
    }
  });
}

/**
 * True when something accepts a TCP connection on `127.0.0.1:port`.
 *
 * 127.0.0.1 rather than `localhost`: the components bind it explicitly
 * (`dev-env.ts` sets `HOST`/`NITRO_HOST`) and Caddy proxies to it, while
 * `localhost` can resolve to `::1` first and miss an IPv4-only listener — the
 * trap `caddy.ts` already documents for the reverse proxy.
 */
export function isPortBound(port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const done = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

/** Send SIGTERM to a detached process group; falls back to single-PID kill. */
export function killProcessGroup(pid: number): boolean {
  if (!isValidPid(pid)) return false;
  try {
    process.kill(-pid, 'SIGTERM');
    return true;
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Probe `ports` for listeners and, where the platform can tell, their owners.
 *
 * The connects run in parallel — one round trip to loopback, not N.
 */
export async function probePorts(ports: number[], options: PortProbeOptions = {}): Promise<PortProbe> {
  const unique = [...new Set(ports)];
  if (unique.length === 0) {
    return { bound: new Set(), owners: new Map(), ownersUnavailable: false };
  }

  const results = await Promise.all(unique.map(async (port) => [port, await isPortBound(port)] as const));
  const bound = new Set(results.filter(([, up]) => up).map(([port]) => port));

  if (bound.size === 0) {
    // Nothing to attribute; skip the subprocess entirely.
    return { bound, owners: new Map(), ownersUnavailable: false };
  }

  const owners = await portOwners([...bound], options);
  return { bound, owners: owners ?? new Map(), ownersUnavailable: owners === null };
}

/**
 * Rotate a log file: rename existing `<logFile>` to `<logFile>.1`, dropping
 * any previous `.1`. Keeps exactly one prior generation so the most recent
 * `lt dev down`-able session stays inspectable without unbounded growth.
 *
 * Returns `{ rotated: false }` when no prior log exists.
 */
export function rotateLogFile(logFile: string): RotateResult {
  let previousSize: number;
  try {
    previousSize = statSync(logFile).size;
  } catch {
    return { rotated: false };
  }
  const archivePath = `${logFile}.1`;
  try {
    unlinkSync(archivePath);
  } catch {
    /* nothing to remove */
  }
  try {
    renameSync(logFile, archivePath);
  } catch {
    return { rotated: false };
  }
  return { archivePath, previousSize, rotated: true };
}

/**
 * Run a child to completion with inherited stdio. Resolves with the exit code.
 *
 * Counterpart of `spawnDetached`: foreground, synchronous-feeling, used for
 * commands the user must see live output from (build, test runners).
 * Errors during spawn resolve as exit code `1` so callers can branch on a
 * single integer instead of try/catch.
 */
export function runChildInherit(cmd: string, args: string[], opts: RunChildOptions): Promise<null | number> {
  return new Promise((resolve) => {
    const child = spawnCmd(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code));
  });
}

/**
 * Run a child to completion with stdout+stderr redirected to a log file.
 * Resolves with the exit code (`1` on spawn error). Like `runChildInherit` but
 * non-interleaving — used to run several children CONCURRENTLY (e.g. parallel
 * Playwright shards) without their console output clobbering each other.
 */
export function runChildToFile(cmd: string, args: string[], opts: SpawnOptions): Promise<null | number> {
  mkdirSync(dirname(opts.logFile), { recursive: true });
  // Rotate so each run starts with a fresh log (one prior generation kept as
  // `<logFile>.1`) instead of appending run-on-run.
  rotateLogFile(opts.logFile);
  const out = openSync(opts.logFile, 'a');
  const close = () => {
    try {
      closeSync(out);
    } catch {
      /* already closed */
    }
  };
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnCmd(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', out, out] });
    } catch {
      close();
      return resolve(1);
    }
    child.on('error', () => {
      close();
      resolve(1);
    });
    child.on('close', (code) => {
      close();
      resolve(code);
    });
  });
}

/**
 * Spawn a detached child whose stdio is redirected to a log file.
 *
 * Rotates any previous log first (one generation kept as `<logFile>.1`) so
 * each session starts with a fresh file. Prevents the multi-day accumulation
 * that produced ~10 GB logs under continuous `up`/`down` cycles.
 *
 * The parent's copy of the log file descriptor is closed in `finally`
 * — the child has already inherited its own fd before `spawn` returns,
 * so closing prevents fd leaks and avoids racing-write artifacts on
 * filesystems where O_APPEND is not atomic.
 *
 * See `detachedSpawnCommand` for how the child is launched per platform.
 *
 * Returns the child PID, or undefined if spawn failed.
 */
export function spawnDetached(
  cmd: string,
  args: string[],
  opts: SpawnOptions,
): undefined | { pid: number; rotated: RotateResult } {
  mkdirSync(dirname(opts.logFile), { recursive: true });
  const rotated = rotateLogFile(opts.logFile);
  const out = openSync(opts.logFile, 'a');

  let child: ChildProcess | undefined;
  try {
    const spawned = detachedSpawnCommand(cmd, args);
    child = spawnCmd(spawned.command, spawned.args, {
      cwd: opts.cwd,
      detached: true,
      env: opts.env,
      stdio: ['ignore', out, out],
    });
    // spawn reports "could not start this at all" (missing executable, bad cwd)
    // through an ASYNCHRONOUS 'error' event — the try/catch around spawn() never
    // sees it. With no listener, Node escalates an unhandled 'error' to a process
    // crash, so one unstartable child would take the whole CLI down with it. That
    // is not hypothetical: on Windows `/bin/sh` does not exist, and this line is
    // what turned that into "Test suite failed to run" instead of one red test.
    // Nothing to do but swallow it — the child is detached and its log file is
    // already closed below; callers are self-correcting against a dead PID.
    child.on('error', () => undefined);
    child.unref();
    if (child.pid === undefined) return undefined;
    return { pid: child.pid, rotated };
  } catch {
    return undefined;
  } finally {
    try {
      closeSync(out);
    } catch {
      /* fd already inherited by child; ignore */
    }
  }
}

/**
 * Terminate a detached process group RELIABLY: SIGTERM the group, wait up to
 * `graceMs` for it to exit, then SIGKILL anything still alive.
 *
 * Needed because a compiled NestJS API (`node dist`) installs shutdown hooks
 * that catch SIGTERM and can hang on open Mongo connections — a single
 * SIGTERM then "succeeds" (the call returns) while the process keeps
 * listening on its port and holding DB connections. `lt dev test`'s
 * residue-free teardown promise depends on the process actually being gone,
 * so we escalate to SIGKILL after a grace period.
 *
 * Polls every 150ms so a process that exits cleanly returns near-instantly
 * (only a hung process waits the full `graceMs`). Returns true if the process
 * is gone by the end, false if it somehow survived even SIGKILL.
 */
export async function terminateProcessGroup(pid: number, graceMs = 4000): Promise<boolean> {
  if (!isValidPid(pid)) return false;
  if (!isPidAlive(pid)) return true;

  // Phase 1 — graceful: SIGTERM the group (single-PID fallback inside).
  killProcessGroup(pid);
  const deadline = Date.now() + Math.max(0, graceMs);
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await delay(150);
  }

  // Phase 2 — forced: SIGKILL the group, then the single PID.
  if (!isPidAlive(pid)) return true;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* group already gone or pid is not a group leader */
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already dead */
  }
  await delay(150);
  return !isPidAlive(pid);
}

/**
 * Poll an HTTPS/HTTP URL until a matching response is observed or `timeoutMs`
 * elapses.
 *
 * Used to wait for dev servers to become reachable before the next step
 * (typically running a test suite). By default treats ANY HTTP status (1xx-5xx)
 * as "up" — a 404 means the server is bound and answering, which is usually
 * what we want to know. Pass `ready` to require a stricter status: an API
 * readiness probe wants a real 2xx on `/meta`, because Caddy answers 502 while
 * its upstream is still booting and the default predicate would accept that
 * prematurely (the cause of the test-suite API-readiness race). Uses `curl`
 * because it is universally available and handles HTTPS-with-self-signed-cert
 * (Caddy) via `-k` for free.
 *
 * Resolves `true` on the first matching response, `false` on timeout. Never rejects.
 */
export function waitForHttp(
  url: string,
  timeoutMs: number,
  ready: (status: number) => boolean = (status) => status >= 100 && status < 600,
  /**
   * Optional early exit: return `true` once there is nothing left to wait FOR —
   * typically "the process I am waiting on has exited". Without it a server that
   * crashes on boot is indistinguishable from one that is still starting, and the
   * caller burns the entire timeout (120s for the `lt dev test` API) before
   * learning something that was decided in the first 300ms.
   */
  abort: () => boolean = () => false,
): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = (): void => {
      httpStatus(url, 2000).then((status) => {
        if (status !== null && ready(status)) {
          return resolve(true);
        }
        // Order matters: a LAST probe already ran above, so a server that came up
        // just before dying is still reported ready. Only then does `abort` end it.
        if (abort()) {
          return resolve(false);
        }
        if (Date.now() - start >= timeoutMs) {
          return resolve(false);
        }
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

/** stdout of a command, or null when it could not run. */
function captureStdout(command: string, args: string[]): Promise<null | string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    let errored = false;
    child.stdout?.on('data', (b) => (stdout += String(b)));
    child.on('error', () => (errored = true));
    child.on('close', () => resolve(errored ? null : stdout));
  });
}

/** Promise-based delay used by the graceful→forced termination escalation. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `lsof` path. Parses the positional column layout. */
async function lsofPortOwners(
  ports: number[],
  capture: CaptureStdout,
): Promise<Map<number, { command: string; pid: number }> | null> {
  const portArgs = ports.flatMap((p) => ['-iTCP', `-iTCP:${p}`]);
  const stdout = await capture('lsof', ['-sTCP:LISTEN', '-nP', ...portArgs]);
  if (stdout === null) return null;

  const result = new Map<number, { command: string; pid: number }>();
  for (const line of stdout.split('\n')) {
    if (!line || line.startsWith('COMMAND')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const portMatch = parts[8].match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    if (ports.includes(port) && /\(LISTEN\)/.test(line)) {
      result.set(port, { command: parts[0], pid: Number(parts[1]) });
    }
  }
  return result;
}

/**
 * Owning process per port, or null when the lookup could not run.
 *
 * POSIX asks `lsof`. Windows asks `netstat -ano` for the pid and `tasklist` for
 * the name — both ship with the OS and neither needs PowerShell, so this works
 * in cmd.exe too.
 */
async function portOwners(
  ports: number[],
  options: PortProbeOptions,
): Promise<Map<number, { command: string; pid: number }> | null> {
  const capture = options.capture ?? captureStdout;
  return isWindows(options.platform) ? windowsPortOwners(ports, capture) : lsofPortOwners(ports, capture);
}

/** `netstat -ano` + `tasklist` path. */
async function windowsPortOwners(
  ports: number[],
  capture: CaptureStdout,
): Promise<Map<number, { command: string; pid: number }> | null> {
  const netstat = await capture('netstat', ['-ano']);
  if (netstat === null) return null;

  const pidByPort = new Map<number, number>();
  for (const line of netstat.split('\n')) {
    // `  TCP    127.0.0.1:4000   0.0.0.0:0   LISTENING   1234`
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || !/^TCP$/i.test(parts[0]) || !/^LISTENING$/i.test(parts[3])) continue;
    const portMatch = parts[1].match(/:(\d+)$/);
    const pid = Number(parts[4]);
    if (!portMatch || !Number.isInteger(pid)) continue;
    const port = Number(portMatch[1]);
    if (ports.includes(port) && !pidByPort.has(port)) pidByPort.set(port, pid);
  }

  const names = await windowsProcessNames([...new Set(pidByPort.values())], capture);
  const result = new Map<number, { command: string; pid: number }>();
  for (const [port, pid] of pidByPort) {
    result.set(port, { command: names.get(pid) ?? String(pid), pid });
  }
  return result;
}

/** Image name per pid via `tasklist`, best effort — an unnamed pid is still a pid. */
async function windowsProcessNames(pids: number[], capture: CaptureStdout): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (pids.length === 0) return names;
  // `/FO CSV /NH` keeps the output parseable without a header line.
  const filters = pids.flatMap((pid) => ['/FI', `PID eq ${pid}`]);
  const out = await capture('tasklist', [...filters, '/FO', 'CSV', '/NH']);
  if (out === null) return names;
  for (const line of out.split('\n')) {
    const match = line.match(/^"([^"]+)","(\d+)"/);
    if (match) names.set(Number(match[2]), match[1]);
  }
  return names;
}
