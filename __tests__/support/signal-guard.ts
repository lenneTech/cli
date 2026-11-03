/**
 * A test may send a real signal only to a process it spawned. Armed for every test
 * file by `signal-guard.setup.ts` (vitest `setupFiles`).
 *
 * Why this exists: on 2026-09-23 at 09:37 a test in `dev-process.test.ts` called
 * `killProcessGroup(1, { platform: 'linux' })`. Only the platform was injected;
 * the signal path stayed real, `isValidPid(1)` let it through, and
 * `process.kill(-1, 'SIGTERM')` is the kill(2) broadcast — every process of the
 * user. It ended every terminal and Claude session on the machine, and the Mac
 * rebooted at 09:39. The comment above the call said "a pid that exists but
 * cannot be signalled"; that was true of `kill(1)`, not of `kill(-1)`.
 *
 * Reviews did not catch it and a naming convention would not have either. This
 * guard does: `process.kill` with a real signal throws unless its target (or the
 * group it names) is a child this worker spawned. Probing with signal 0 stays
 * allowed — it delivers nothing.
 *
 * Scope: signals sent from inside the test worker. A CLI subprocess a test
 * spawns runs without this guard.
 *
 * The state lives on `process`, not in this module: vitest loads a fresh copy of
 * every module per test file while `process` stays the same object. Module-level
 * state would wrap `process.kill` once per file, and the refusals the first copy
 * records would never reach the `afterEach` of a later file.
 */
import { ChildProcess } from 'child_process';

interface GuardState {
  spawned: Set<number>;
  violations: string[];
}

const STATE = Symbol.for('lt-cli.signal-guard.state');
const holder = process as unknown as Record<symbol, GuardState | undefined>;

/** True once `installSignalGuard` ran in this process. */
export function guardInstalled(): boolean {
  return holder[STATE] !== undefined;
}

/**
 * Wrap `process.kill` and record every child this process spawns. Idempotent: a
 * second call in the same process does nothing.
 */
export function installSignalGuard(): void {
  if (holder[STATE]) {
    return;
  }
  const state: GuardState = { spawned: new Set(), violations: [] };

  // Every async child_process API (spawn, exec, execFile, fork) and cross-spawn
  // ends in ChildProcess.prototype.spawn, so recording here sees all of them.
  const proto = ChildProcess.prototype as unknown as { spawn: (...args: unknown[]) => unknown };
  const originalSpawn = proto.spawn;
  proto.spawn = function (this: ChildProcess, ...args: unknown[]) {
    const result = originalSpawn.apply(this, args);
    if (typeof this.pid === 'number') {
      state.spawned.add(this.pid);
    }
    return result;
  };

  const realKill = process.kill.bind(process);
  process.kill = ((pid: number, signal?: number | string) => {
    const verdict = signalVerdict(pid, signal ?? 'SIGTERM', state.spawned);
    if (verdict) {
      const message = `signal-guard: process.kill(${pid}, ${String(signal ?? 'SIGTERM')}) ${verdict}`;
      state.violations.push(message);
      throw new Error(message);
    }
    return realKill(pid, signal);
  }) as typeof process.kill;

  holder[STATE] = state;
}

/**
 * Why a signal must not be sent, or null when it may. Pure, so the guard's own
 * test never has to send anything real to prove the decision.
 */
export function signalVerdict(pid: unknown, signal: unknown, spawned: ReadonlySet<number>): null | string {
  if (signal === 0) return null;
  if (typeof pid !== 'number' || !Number.isInteger(pid)) return `refused: pid ${String(pid)} is not an integer`;
  if (pid === 0 || pid === -1) return `refused: pid ${pid} addresses every process of a group or of the user`;
  if (!spawned.has(Math.abs(pid))) {
    return `refused: ${pid < 0 ? 'process group' : 'pid'} ${Math.abs(pid)} was not spawned by this test worker`;
  }
  return null;
}

/** Drain recorded refusals: for the setup file's `afterEach` and the guard's own wiring test. */
export function takeViolations(): string[] {
  return holder[STATE]?.violations.splice(0) ?? [];
}
