/**
 * Process + port helpers for `lt dev`.
 *
 * - `spawnDetached`: detached child whose stdout/stderr go to a log file.
 *   The Claude Code session does NOT block waiting for it, and `lt dev down`
 *   can SIGTERM the entire process group via `process.kill(-pid, …)`.
 * - `listenSnapshot` / `checkPortInUse`: thin lsof wrappers used by
 *   `lt dev doctor` to detect port collisions.
 */
import { ChildProcess, spawn } from 'child_process';
import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync } from 'fs';
import { dirname } from 'path';

import { isPidAlive, isValidPid } from './dev-state';

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
 * Check via `lsof` whether a single TCP port is bound by a LISTEN socket.
 * Returns null if lsof is unavailable.
 */
export async function checkPortInUse(port: number): Promise<null | { command?: string; inUse: boolean; pid?: number }> {
  return new Promise((resolve) => {
    const child = spawn('lsof', ['-iTCP', `-sTCP:LISTEN`, '-nP', `-iTCP:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let errored = false;
    child.stdout?.on('data', (b) => (stdout += String(b)));
    child.on('error', () => (errored = true));
    child.on('close', () => {
      if (errored) return resolve(null);
      const lines = stdout.split('\n').filter((l) => l && !l.startsWith('COMMAND'));
      const matching = lines.find(
        (l) => new RegExp(`[: ]${port}\\s.*\\(LISTEN\\)`).test(l) || l.includes(`:${port} (LISTEN)`),
      );
      if (!matching) return resolve({ inUse: false });
      const parts = matching.trim().split(/\s+/);
      resolve({ command: parts[0], inUse: true, pid: Number(parts[1]) });
    });
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
 * Multi-port lsof snapshot — single subprocess for N ports.
 * Returns map<port, {command, pid}> for ports that are in use.
 */
export async function listenSnapshot(ports: number[]): Promise<Map<number, { command: string; pid: number }>> {
  const result = new Map<number, { command: string; pid: number }>();
  if (ports.length === 0) return result;
  return new Promise((resolve) => {
    const portArgs = ports.flatMap((p) => ['-iTCP', `-iTCP:${p}`]);
    const child = spawn('lsof', ['-sTCP:LISTEN', '-nP', ...portArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let errored = false;
    child.stdout?.on('data', (b) => (stdout += String(b)));
    child.on('error', () => (errored = true));
    child.on('close', () => {
      if (errored) return resolve(result);
      for (const line of stdout.split('\n')) {
        if (!line || line.startsWith('COMMAND')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 9) continue;
        const command = parts[0];
        const pid = Number(parts[1]);
        const name = parts[8];
        const portMatch = name.match(/:(\d+)$/);
        if (!portMatch) continue;
        const port = Number(portMatch[1]);
        if (ports.includes(port) && /\(LISTEN\)/.test(line)) {
          result.set(port, { command, pid });
        }
      }
      resolve(result);
    });
  });
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
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: 'inherit' });
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
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', out, out] });
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
    child = spawn(cmd, args, {
      cwd: opts.cwd,
      detached: true,
      env: opts.env,
      stdio: ['ignore', out, out],
    });
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
): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const child = spawn('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '2', url], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let status = '';
      child.stdout?.on('data', (b) => (status += String(b)));
      child.on('close', () => {
        const code = Number(status.trim());
        // `000` (curl could not connect) parses to 0 → never "ready".
        if (Number.isFinite(code) && code > 0 && ready(code)) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 500);
      });
      child.on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

/** Promise-based delay used by the graceful→forced termination escalation. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
