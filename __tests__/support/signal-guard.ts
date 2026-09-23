/**
 * Jest `setupFilesAfterEnv`: a test may send a real signal only to a process it spawned.
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
 * Scope: signals sent from inside the Jest worker. A CLI subprocess a test
 * spawns runs without this guard.
 */
import { ChildProcess } from 'child_process';

const SPAWNED = Symbol.for('lt-cli.signal-guard.spawned');

interface Registry {
  [SPAWNED]?: Set<number>;
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

/** Pids of children spawned in this worker, shared across test files. */
function spawnedRegistry(): Set<number> {
  const proto = ChildProcess.prototype as unknown as Registry & { spawn: (...a: unknown[]) => unknown };
  if (!proto[SPAWNED]) {
    const spawned = new Set<number>();
    const original = proto.spawn;
    // Every async child_process API (spawn, exec, execFile, fork) and cross-spawn
    // ends in ChildProcess.prototype.spawn, so recording here sees all of them.
    proto.spawn = function (this: ChildProcess, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (typeof this.pid === 'number') spawned.add(this.pid);
      return result;
    };
    proto[SPAWNED] = spawned;
  }
  return proto[SPAWNED];
}

const spawned = spawnedRegistry();
const realKill = process.kill.bind(process);
const violations: string[] = [];

process.kill = ((pid: number, signal?: number | string) => {
  const verdict = signalVerdict(pid, signal ?? 'SIGTERM', spawned);
  if (verdict) {
    const message = `signal-guard: process.kill(${pid}, ${String(signal ?? 'SIGTERM')}) ${verdict}`;
    violations.push(message);
    throw new Error(message);
  }
  return realKill(pid, signal);
}) as typeof process.kill;

/** Drain recorded refusals — for the guard's own wiring test only. */
export function takeViolations(): string[] {
  return violations.splice(0);
}

// Throwing alone is not enough: code under test that wraps `process.kill` in a
// try/catch (as every kill helper in `src/` does) would swallow the refusal and
// the test would pass. So a refused signal also fails the test it happened in.
afterEach(() => {
  if (violations.length === 0) return;
  const found = takeViolations();
  throw new Error(`${found.length} refused signal(s) in this test:\n${found.join('\n')}`);
});
