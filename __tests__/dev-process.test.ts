import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { rotateLogFile, runChildInherit, spawnDetached, terminateProcessGroup, waitForHttp } from '../src/lib/dev-process';

describe('rotateLogFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-dev-process-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('returns rotated:false when there is no prior log', () => {
    const result = rotateLogFile(join(dir, 'app.log'));
    expect(result.rotated).toBe(false);
    expect(result.archivePath).toBeUndefined();
  });

  it('moves an existing log to <name>.1 and reports its prior size', () => {
    const log = join(dir, 'app.log');
    writeFileSync(log, 'hello\n');

    const result = rotateLogFile(log);

    expect(result.rotated).toBe(true);
    expect(result.archivePath).toBe(`${log}.1`);
    expect(result.previousSize).toBe(6);
    expect(existsSync(log)).toBe(false);
    expect(readFileSync(`${log}.1`, 'utf8')).toBe('hello\n');
  });

  it('overwrites a prior generation so disk usage stays bounded', () => {
    const log = join(dir, 'app.log');
    writeFileSync(`${log}.1`, 'oldest');
    writeFileSync(log, 'newer');

    const result = rotateLogFile(log);

    expect(result.rotated).toBe(true);
    expect(readFileSync(`${log}.1`, 'utf8')).toBe('newer');
    expect(existsSync(log)).toBe(false);
  });
});

describe('runChildInherit', () => {
  it('resolves with the child exit code', async () => {
    const code = await runChildInherit('node', ['-e', 'process.exit(0)'], { cwd: process.cwd(), env: process.env });
    expect(code).toBe(0);
  });

  it('propagates non-zero exit codes', async () => {
    const code = await runChildInherit('node', ['-e', 'process.exit(7)'], { cwd: process.cwd(), env: process.env });
    expect(code).toBe(7);
  });

  it('resolves with 1 when the binary cannot be spawned', async () => {
    const code = await runChildInherit('lt-dev-definitely-not-a-real-binary', [], {
      cwd: process.cwd(),
      env: process.env,
    });
    expect(code).toBe(1);
  });
});

describe('waitForHttp', () => {
  it('resolves false on timeout for an unreachable URL', async () => {
    // RFC 5737 TEST-NET-1 is non-routable, so the curl probe is guaranteed
    // to time out without hitting an unrelated service. Keep the budget
    // tight so the test stays under jest's default 5s timeout.
    const ok = await waitForHttp('https://192.0.2.1:1/', 1_500);
    expect(ok).toBe(false);
  });
});

describe('terminateProcessGroup', () => {
  // Track spawned PIDs so a failed assertion never leaks a real process.
  const spawned: number[] = [];

  /** Spawn a detached (own process-group leader) node child running `code`. */
  function spawnDetachedNode(code: string): number {
    const child = spawn('node', ['-e', code], { detached: true, stdio: 'ignore' });
    child.unref();
    const pid = child.pid as number;
    spawned.push(pid);
    return pid;
  }

  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  afterEach(() => {
    for (const pid of spawned.splice(0)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
  });

  it('returns false for an invalid PID', async () => {
    await expect(terminateProcessGroup(0)).resolves.toBe(false);
  });

  it('returns true for a valid-but-already-dead PID', async () => {
    // A PID in range that is virtually certain not to be running.
    await expect(terminateProcessGroup(2_000_001, 200)).resolves.toBe(true);
  });

  it('terminates a SIGTERM-respecting process gracefully (fast path)', async () => {
    const pid = spawnDetachedNode('setInterval(() => {}, 1000)');
    // Give the child a moment to actually start.
    await new Promise((r) => setTimeout(r, 100));
    expect(isAlive(pid)).toBe(true);

    const gone = await terminateProcessGroup(pid, 3000);
    expect(gone).toBe(true);
    expect(isAlive(pid)).toBe(false);
  });

  it('escalates to SIGKILL when the process ignores SIGTERM', async () => {
    // This child traps SIGTERM and never exits — exactly the compiled-NestJS
    // graceful-shutdown-hangs-on-Mongo case the escalation exists for.
    const pid = spawnDetachedNode("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)");
    await new Promise((r) => setTimeout(r, 100));
    expect(isAlive(pid)).toBe(true);

    // SIGTERM is ignored → only the SIGKILL fallback after the short grace can
    // reap it. A tiny grace keeps the test fast.
    const gone = await terminateProcessGroup(pid, 400);
    expect(gone).toBe(true);
    expect(isAlive(pid)).toBe(false);
  });
});

describe('spawnDetached (sh/exec FD-limit wrapper)', () => {
  let dir: string;
  const spawnedPids: number[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-dev-spawn-'));
  });

  afterEach(() => {
    // Children exit on their own (write + exit); this is a belt-and-braces sweep.
    for (const pid of spawnedPids.splice(0)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    rmSync(dir, { force: true, recursive: true });
  });

  /** Poll the detached child's log file until it has content or the budget elapses. */
  async function readLogWhenReady(logFile: string, budgetMs = 3_000): Promise<string> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (existsSync(logFile)) {
        const content = readFileSync(logFile, 'utf8');
        if (content.length > 0) return content;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  }

  it('preserves PID identity through the wrapper — the recorded pid IS the real process', async () => {
    const logFile = join(dir, 'pid.log');
    const result = spawnDetached('node', ['-e', 'process.stdout.write(String(process.pid))'], {
      cwd: process.cwd(),
      env: process.env,
      logFile,
    });
    if (!result) throw new Error('spawnDetached returned undefined');
    spawnedPids.push(result.pid);

    const reported = (await readLogWhenReady(logFile)).trim();
    // `exec` replaces the shell in-place, so the child's own process.pid must equal
    // the pid spawnDetached recorded — the invariant PID-tracking + group-kill rely on.
    expect(reported).toBe(String(result.pid));
  });

  it('passes args verbatim — no shell word-splitting, glob, or command substitution', async () => {
    const logFile = join(dir, 'args.log');
    // Args laden with shell metacharacters: if any were re-parsed by the `sh -c`
    // wrapper, the echoed values would differ (or `pwned`/`nope` would execute).
    const args = ['a; b | c', '$(echo pwned)', 'has spaces', '`echo nope`', '*'];
    const result = spawnDetached(
      'node',
      ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args],
      { cwd: process.cwd(), env: process.env, logFile },
    );
    if (!result) throw new Error('spawnDetached returned undefined');
    spawnedPids.push(result.pid);

    const out = (await readLogWhenReady(logFile)).trim();
    expect(JSON.parse(out)).toEqual(args);
  });

  it('raises the soft file-descriptor limit above the problematic default before exec', async () => {
    const logFile = join(dir, 'ulimit.log');
    const result = spawnDetached('sh', ['-c', 'ulimit -n'], {
      cwd: process.cwd(),
      env: process.env,
      logFile,
    });
    if (!result) throw new Error('spawnDetached returned undefined');
    spawnedPids.push(result.pid);

    const raw = (await readLogWhenReady(logFile)).trim();
    // The cascade raises the soft limit well past the macOS default soft-256 the
    // chokidar watcher exhausts (or leaves an already-higher / unlimited value intact).
    if (raw !== 'unlimited') {
      expect(Number(raw)).toBeGreaterThan(256);
    }
  });
});
