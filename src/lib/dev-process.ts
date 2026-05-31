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

import { isValidPid } from './dev-state';

export interface RotateResult {
  /** Path the previous log was moved to (only set when `rotated`). */
  archivePath?: string;
  /** Size in bytes of the previous log before rotation (only set when `rotated`). */
  previousSize?: number;
  rotated: boolean;
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
