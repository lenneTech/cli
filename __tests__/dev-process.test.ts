import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { detachedSpawnCommand, rotateLogFile, runChildInherit, spawnDetached, terminateProcessGroup, waitForHttp } from '../src/lib/dev-process';

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

describe('detachedSpawnCommand', () => {
  const raiseFd = expect.stringContaining('ulimit -n');

  it('wraps the command in sh -c on POSIX so the fd limit is raised first', () => {
    const { args, command } = detachedSpawnCommand('node', ['server.js', '--port=1'], 'darwin');
    expect(command).toBe('/bin/sh');
    expect(args[0]).toBe('-c');
    expect(args[1]).toEqual(raiseFd);
    // `"$0" "$@"` — cmd and args travel as positional parameters, never
    // interpolated into the script, so nothing needs shell-quoting.
    expect(args.slice(2)).toEqual(['node', 'server.js', '--port=1']);
  });

  it('keeps `exec` so the recorded PID is the real process, not a shell', () => {
    // terminateProcessGroup kills the recorded PID's group. Without `exec` the
    // shell would stay in between and the PID would not be the server.
    const { args } = detachedSpawnCommand('node', ['server.js'], 'linux');
    expect(args[1]).toEqual(expect.stringContaining('exec "$0" "$@"'));
  });

  it('spawns the command directly on Windows — there is no /bin/sh there', () => {
    // A `/bin/sh` that does not exist makes spawn emit an async 'error' event
    // instead of returning, which used to take the whole process down. Windows
    // also has no RLIMIT_NOFILE, so the wrapper buys nothing there anyway.
    const { args, command } = detachedSpawnCommand('node', ['server.js', '--port=1'], 'win32');
    expect(command).toBe('node');
    expect(args).toEqual(['server.js', '--port=1']);
  });
});

describe('spawnDetached error handling', () => {
  it('survives a command that cannot be spawned at all', async () => {
    // spawn reports a missing executable through an asynchronous 'error' event,
    // which a try/catch around spawn() cannot see. With no listener attached,
    // Node treats it as an unhandled 'error' and terminates the process — so
    // this test failing looks like the whole suite crashing, which is exactly
    // what happened on Windows where /bin/sh is absent.
    const logFile = join(tmpdir(), `lt-dev-spawn-guard-${String(Date.now())}.log`);
    const opts = { cwd: tmpdir(), env: process.env, logFile };
    expect(() => spawnDetached('lt-definitely-not-a-real-binary-xyz', [], opts)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(true).toBe(true); // reached only if no unhandled 'error' killed the run
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

  it('gives up early when `abort` reports the process is gone', async () => {
    // A server that crashes on boot never answers, so the full timeout is pure
    // dead time — 120s of it for the `lt dev test` API. `abort` lets the caller
    // stop as soon as the PID it is waiting on has exited.
    const start = Date.now();
    const ok = await waitForHttp('https://192.0.2.1:1/', 60_000, undefined, () => true);
    expect(ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it('keeps polling while `abort` stays false', async () => {
    // The guard must not short-circuit a server that is merely still booting.
    // Probe a port that REFUSES (a server not listening yet) rather than the
    // black-holed TEST-NET address the timeout test uses: there every probe
    // burns curl's full `--max-time 2`, so only two probes fit into the budget
    // with ~0.4s to spare — and `retry` skips `abort` once the budget is spent.
    // Under load the second probe missed that window and the test failed with
    // `calls === 1` on unchanged code. A refused connection returns in
    // milliseconds, so the 500ms poll interval decides the count, not the
    // machine. (Windows retries a refused connect for up to ~2s, which is no
    // slower than the black hole was.)
    let calls = 0;
    const ok = await waitForHttp('https://127.0.0.1:1/', 5_000, undefined, () => {
      calls++;
      return false;
    });
    expect(ok).toBe(false);
    expect(calls).toBeGreaterThan(1);
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

  afterEach(async () => {
    // Children exit on their own (write + exit); this is a belt-and-braces sweep.
    for (const pid of spawnedPids.splice(0)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* already gone (and a negative pid is not a process group on Windows) */
      }
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    // Wait for the log file's writer to actually let go before removing the dir.
    // Windows refuses to unlink a file that is still open, so a child that has
    // been signalled but not yet reaped makes rmSync throw ENOTEMPTY — which
    // failed the two tests above in teardown while their assertions had passed.
    // POSIX unlinks a still-open file happily, which is why this never showed up
    // locally. `maxRetries` covers the same race for the kill itself.
    await new Promise((resolve) => setTimeout(resolve, 50));
    rmSync(dir, { force: true, maxRetries: 10, recursive: true, retryDelay: 50 });
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

  // POSIX only, and that is the point rather than a gap: Windows has no
  // RLIMIT_NOFILE, so `detachedSpawnCommand` deliberately spawns the command
  // directly there and there is no wrapper to observe. What Windows guarantees
  // instead — that the command is spawned with no shell in between — is asserted
  // in the `detachedSpawnCommand` block above, on every platform.
  const itPosix = process.platform === 'win32' ? it.skip : it;

  itPosix('raises the soft file-descriptor limit above the problematic default before exec', async () => {
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

describe('probePorts', () => {
  const { isPortBound, probePorts } = require('../src/lib/dev-process');
  const nodeNet = require('net');

  const listen = (): Promise<{ close: () => void; port: number }> =>
    new Promise((resolve) => {
      const server = nodeNet.createServer();
      // Drop every accepted socket at once: `server.close()` stops new
      // connections but waits for open ones, which left Jest with an open handle.
      server.on('connection', (socket: { destroy: () => void }) => socket.destroy());
      server.unref();
      server.listen(0, '127.0.0.1', () =>
        resolve({ close: () => server.close(), port: (server.address() as { port: number }).port }),
      );
    });

  it('sees a listener and reports a closed port as free', async () => {
    const server = await listen();
    try {
      expect(await isPortBound(server.port)).toBe(true);
    } finally {
      server.close();
    }
    // Same port, now nothing behind it.
    expect(await isPortBound(server.port)).toBe(false);
  });

  it('separates "bound" from "who owns it"', async () => {
    const server = await listen();
    try {
      const probe = await probePorts([server.port]);
      // Measured by a TCP connect — reliable on every platform.
      expect(probe.bound.has(server.port)).toBe(true);
      // The owner lookup needs a tool and may legitimately come up empty; what
      // must never happen is an unavailable lookup reading as "nothing bound".
      // That was the predecessor's failure mode: an empty map on a missing lsof,
      // which classified every running component as crashed.
      if (probe.ownersUnavailable) {
        expect(probe.owners.size).toBe(0);
      } else if (probe.owners.has(server.port)) {
        expect(probe.owners.get(server.port).pid).toBe(process.pid);
      }
    } finally {
      server.close();
    }
  });

  it('asks nothing and reports nothing for an empty port list', async () => {
    const probe = await probePorts([]);
    expect([probe.bound.size, probe.owners.size, probe.ownersUnavailable]).toEqual([0, 0, false]);
  });

  it('does not report free ports as owner-unavailable', async () => {
    // Nothing bound means nothing to attribute, so the owner lookup never runs —
    // and must not be reported as having failed.
    const probe = await probePorts([1]);
    expect(probe.ownersUnavailable).toBe(false);
  });
});

describe('isPidAlive and EPERM', () => {
  const { isPidAlive } = require('../src/lib/dev-state');

  it('treats a process it may not signal as alive, not dead', () => {
    // `process.kill(1, 0)` throws EPERM on POSIX: PID 1 exists, we may not
    // signal it. Reading that as "dead" made `lt dev up` restart a healthy
    // component. On Windows an elevated process produces the same situation.
    expect(isPidAlive(process.pid)).toBe(true);
    if (process.platform !== 'win32') {
      expect(isPidAlive(1)).toBe(true);
    }
  });

  it('still reports a genuinely absent pid as dead', async () => {
    // A pid that has provably exited, rather than a high number that merely
    // looks unused — `pid_max` is configurable, so "probably nobody" is not a
    // property a test may rely on.
    const { spawnCmd } = require('../src/lib/platform');
    const child = spawnCmd(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const pid: number = child.pid;
    await new Promise((resolve) => child.on('close', resolve));
    expect(isPidAlive(pid)).toBe(false);
  });
});

describe('probePorts owner lookup — both platform branches, from any host', () => {
  const { probePorts } = require('../src/lib/dev-process');
  const nodeNet = require('net');

  const listen = (): Promise<{ close: () => void; port: number }> =>
    new Promise((resolve) => {
      const server = nodeNet.createServer();
      server.on('connection', (socket: { destroy: () => void }) => socket.destroy());
      server.unref();
      server.listen(0, '127.0.0.1', () =>
        resolve({ close: () => server.close(), port: (server.address() as { port: number }).port }),
      );
    });

  it('reports ownersUnavailable when the tool cannot run — and still knows the port is bound', async () => {
    // THE failure mode this rewrite exists for. The predecessor returned an empty
    // map when `lsof` was missing, which is indistinguishable from "nothing is
    // bound": every component then classified as crashed and `lt dev up`
    // restarted a healthy stack. `bound` comes from a TCP connect, so it stays
    // true regardless; only the attribution is lost, and it says so.
    const server = await listen();
    try {
      const probe = await probePorts([server.port], { capture: async () => null, platform: 'linux' });
      expect(probe.bound.has(server.port)).toBe(true);
      expect(probe.ownersUnavailable).toBe(true);
      expect(probe.owners.size).toBe(0);
    } finally {
      server.close();
    }
  });

  it('parses lsof output', async () => {
    const server = await listen();
    const lsof = [
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      `node    4242 me     23u  IPv4 0x1234      0t0  TCP 127.0.0.1:${server.port} (LISTEN)`,
    ].join('\n');
    try {
      const probe = await probePorts([server.port], { capture: async () => lsof, platform: 'darwin' });
      expect(probe.ownersUnavailable).toBe(false);
      expect(probe.owners.get(server.port)).toEqual({ command: 'node', pid: 4242 });
    } finally {
      server.close();
    }
  });

  it('parses netstat + tasklist output — the Windows branch, exercised here', async () => {
    const server = await listen();
    const capture = async (command: string): Promise<string> => {
      if (command === 'netstat') {
        return [
          'Aktive Verbindungen',
          '  Proto  Lokale Adresse         Remoteadresse          Status           PID',
          // The ESTABLISHED row comes FIRST on purpose: a client connection to
          // the same port carries a different pid, and the first match wins. If
          // the LISTENING filter were dropped, this test would report the
          // connecting process instead of the server — which is what
          // `reclaimPort` would then terminate.
          `  TCP    127.0.0.1:${server.port}        127.0.0.1:51000        ESTABLISHED     9999`,
          '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900',
          `  TCP    127.0.0.1:${server.port}        0.0.0.0:0              LISTENING       7654`,
        ].join('\n');
      }
      return '"caddy.exe","7654","Console","1","52.000 K"';
    };
    try {
      const probe = await probePorts([server.port], { capture, platform: 'win32' });
      expect(probe.ownersUnavailable).toBe(false);
      // The LISTENING row wins over the ESTABLISHED one despite coming later,
      // and the name comes from tasklist rather than being left as a bare pid.
      expect(probe.owners.get(server.port)).toEqual({ command: 'caddy.exe', pid: 7654 });
    } finally {
      server.close();
    }
  });

  it('falls back to the bare pid when tasklist says nothing', async () => {
    const server = await listen();
    const capture = async (command: string): Promise<string> =>
      command === 'netstat'
        ? `  TCP    127.0.0.1:${server.port}   0.0.0.0:0   LISTENING   31337`
        : 'INFORMATION: No tasks are running which match the specified criteria.';
    try {
      const probe = await probePorts([server.port], { capture, platform: 'win32' });
      expect(probe.owners.get(server.port)).toEqual({ command: '31337', pid: 31337 });
    } finally {
      server.close();
    }
  });
});

describe('httpStatus — the probe that replaced `curl -o /dev/null`', () => {
  const { httpStatus, waitForHttp } = require('../src/lib/dev-process');
  const nodeHttp = require('http');

  const serve = (handler: (req: unknown, res: { end: () => void; statusCode: number }) => void) =>
    new Promise<{ close: () => void; url: string }>((resolve) => {
      const server = nodeHttp.createServer(handler);
      server.unref();
      server.listen(0, '127.0.0.1', () =>
        resolve({
          close: () => server.close(),
          url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
        }),
      );
    });

  it('reports the status of a reachable endpoint', async () => {
    // The regression this guards: `curl -fsS -o /dev/null` exits 23 on Windows —
    // `/dev/null` is a file path there, not the null device — AFTER a successful
    // request. Callers read the exit code, so a running Caddy answering 200 was
    // reported as "daemon is not running". Nothing in the response was wrong;
    // only writing it to nowhere failed.
    const server = await serve((_req, res) => {
      res.statusCode = 204;
      res.end();
    });
    try {
      expect(await httpStatus(server.url)).toBe(204);
    } finally {
      server.close();
    }
  });

  it('reports a 500 as a status, not as unreachable', async () => {
    // "Reachable" and "healthy" are different questions; `caddyDaemonRunning`
    // asks the first one.
    const server = await serve((_req, res) => {
      res.statusCode = 500;
      res.end();
    });
    try {
      expect(await httpStatus(server.url)).toBe(500);
    } finally {
      server.close();
    }
  });

  it('returns null when nothing answers', async () => {
    const server = await serve((_req, res) => res.end());
    const url = server.url;
    server.close();
    expect(await httpStatus(url, 700)).toBeNull();
  });

  it('waitForHttp gives up within its budget when nothing comes up', async () => {
    const started = Date.now();
    const ok = await waitForHttp('http://127.0.0.1:1/', 900);
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(8000);
  });

  it('waitForHttp stops early once `abort` says there is nothing left to wait for', async () => {
    const started = Date.now();
    const ok = await waitForHttp('http://127.0.0.1:1/', 30_000, undefined, () => true);
    expect(ok).toBe(false);
    // The point of `abort`: a component that died on boot must not burn the full
    // timeout (120s for the `lt dev test` API).
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('planTermination — the only gate between a stored number and a signal', () => {
  const { planTermination } = require('../src/lib/dev-process');
  const self = { pid: 50_000, ppid: 49_999 };

  it('refuses pid 1 on POSIX: `-1` is the kill(2) broadcast, not a group', () => {
    // 2026-09-23: exactly this pid, sent through the real signal path by a test,
    // SIGTERMed every process of the user and rebooted the Mac.
    expect(planTermination(1, 'darwin', self).kind).toBe('refuse');
    expect(planTermination(1, 'linux', self).kind).toBe('refuse');
  });

  it('refuses the Windows system pids 0 and 4, and allows the next one', () => {
    expect(planTermination(4, 'win32', self).kind).toBe('refuse');
    expect(planTermination(8, 'win32', self)).toEqual({ kind: 'taskkill', target: 8 });
  });

  it('refuses this CLI and its parent', () => {
    expect(planTermination(self.pid, 'linux', self).kind).toBe('refuse');
    expect(planTermination(self.ppid, 'linux', self).kind).toBe('refuse');
  });

  it('refuses what a corrupted state.json can hold', () => {
    for (const pid of [0, -5, 1.5, Number.NaN, '4242', null, undefined]) {
      expect(planTermination(pid, 'linux', self).kind).toBe('refuse');
    }
  });

  it('plans a group signal for an ordinary pid', () => {
    expect(planTermination(2, 'linux', self)).toEqual({ kind: 'group', target: 2 });
  });
});

describe('killProcessGroup / terminateProcessGroup — every signal injected, none real', () => {
  const { killProcessGroup, terminateProcessGroup: terminate } = require('../src/lib/dev-process');

  /** Records instead of acting. Nothing here may reach `process.kill` or `taskkill`. */
  const fake = (aliveChecks: boolean[] = []) => {
    const signals: [number, string][] = [];
    const runs: { args: string[]; command: string }[] = [];
    let checks = 0;
    return {
      options: (platform: NodeJS.Platform) => ({
        isAlive: () => aliveChecks[Math.min(checks++, aliveChecks.length - 1)] ?? false,
        platform,
        run: (command: string, args: string[]) => {
          runs.push({ args, command });
          return { status: 0 };
        },
        signal: (pid: number, sig: string) => {
          signals.push([pid, sig]);
        },
      }),
      runs,
      signals,
    };
  };

  it('sends nothing for pid 1 on POSIX', () => {
    const f = fake();
    expect(killProcessGroup(1, f.options('linux'))).toBe(false);
    expect(f.signals).toEqual([]);
  });

  it('sends SIGTERM to the group of an ordinary pid on POSIX', () => {
    const f = fake();
    expect(killProcessGroup(4242, f.options('linux'))).toBe(true);
    expect(f.signals).toEqual([[-4242, 'SIGTERM']]);
  });

  it('uses `taskkill /T /F` on Windows — `/F` is not optional', () => {
    // Measured: `taskkill /PID <pid> /T` WITHOUT `/F` fails on the children and
    // leaves the port bound — a refusal, not a graceful stop.
    const f = fake();
    killProcessGroup(4242, f.options('win32'));
    expect(f.runs).toEqual([{ args: ['/PID', '4242', '/T', '/F'], command: 'taskkill' }]);
    expect(f.signals).toEqual([]);
  });

  it('on Windows, one `/T /F` ends it — there is no gentler first step to wait out', async () => {
    // alive before, gone after the first taskkill
    const f = fake([true, false]);
    await expect(terminate(4242, 1000, f.options('win32'))).resolves.toBe(true);
    expect(f.runs).toHaveLength(1);
  });

  it('on Windows, a survivor gets a second `/T /F` and an honest false', async () => {
    const f = fake([true]);
    await expect(terminate(4242, 200, f.options('win32'))).resolves.toBe(false);
    expect(f.runs).toHaveLength(2);
    expect(f.signals).toEqual([]);
  });

  it('on POSIX, a survivor is escalated from SIGTERM to SIGKILL on the group', async () => {
    const f = fake([true]);
    await expect(terminate(4242, 200, f.options('linux'))).resolves.toBe(false);
    expect(f.signals).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL'],
    ]);
  });
});
