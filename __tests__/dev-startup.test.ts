import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { AddressInfo, createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { diagnoseLog } from '../src/lib/dev-log-tail';
import { spawnDetached, terminateProcessGroup } from '../src/lib/dev-process';
import { waitForStartup } from '../src/lib/dev-startup';

/**
 * DEV-4130: `lt dev up` reported "Started" with exit 0 for an API that died in `migrate:up`.
 * It only watched the fresh pids for 3 s, and ts-node plus a migration take longer than that.
 * These tests start real processes through the same `spawnDetached` the command uses.
 */
describe('waitForStartup', () => {
  let dir: string;
  let spawned: number[];

  /** Starts `code` as a detached node process with its own log, as `lt dev up` starts a component. */
  function start(name: string, code: string): { logFile: string; pid: number } {
    const script = join(dir, `${name}.js`);
    writeFileSync(script, code);
    const logFile = join(dir, `${name}.log`);
    const result = spawnDetached(process.execPath, [script], { cwd: dir, env: process.env, logFile });
    if (!result) throw new Error(`could not start ${name}`);
    spawned.push(result.pid);
    return { logFile, pid: result.pid };
  }

  async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-dev-startup-'));
    spawned = [];
  });

  afterEach(async () => {
    // Wait until each process is gone before removing its directory: Windows refuses to unlink a
    // log file a signalled but not yet reaped child still holds (see dev-process.test.ts).
    for (const pid of spawned) await terminateProcessGroup(pid, 2000);
    rmSync(dir, { force: true, maxRetries: 10, recursive: true, retryDelay: 50 });
  });

  it('an API whose start exits 1 at once fails as dead, and its log holds the cause', async () => {
    const api = start('api', "console.error('migrate:up failed: NODE_ENV is not set'); process.exit(1);");

    const outcome = await waitForStartup([{ name: 'api', pid: api.pid, port: await freePort() }]);

    expect(outcome.ready).toEqual([]);
    expect(outcome.failed).toEqual([{ name: 'api', pid: api.pid, state: 'dead' }]);
    expect(diagnoseLog(api.logFile).tail).toContain('migrate:up failed: NODE_ENV is not set');
  });

  it('an API that dies after the old 3 s window (a migration that fails late) still fails', async () => {
    const api = start('api', "setTimeout(() => { console.error('migration failed'); process.exit(1); }, 4000);");
    const begin = Date.now();

    const outcome = await waitForStartup([{ name: 'api', pid: api.pid, port: await freePort() }]);

    expect(outcome.failed).toEqual([{ name: 'api', pid: api.pid, state: 'dead' }]);
    expect(Date.now() - begin).toBeGreaterThanOrEqual(3500);
  });

  it('a slow but healthy boot is ready once it listens, not a false alarm', async () => {
    const port = await freePort();
    const api = start('api', `setTimeout(() => require('net').createServer().listen(${port}, '127.0.0.1'), 2000);`);
    const begin = Date.now();

    const outcome = await waitForStartup([{ name: 'api', pid: api.pid, port }]);

    expect(outcome).toEqual({ failed: [], ready: ['api'] });
    // Returns as soon as the port is bound, not after the grace window.
    expect(Date.now() - begin).toBeLessThan(10_000);
  });

  it('a process that stays alive without listening is crashed once the grace window has passed', async () => {
    const api = start('api', 'setInterval(() => {}, 1000);');
    const begin = Date.now();

    const outcome = await waitForStartup([{ name: 'api', pid: api.pid, port: await freePort() }], { graceMs: 1500 });

    expect(outcome.failed).toEqual([{ name: 'api', pid: api.pid, state: 'crashed' }]);
    expect(Date.now() - begin).toBeGreaterThanOrEqual(1500);
  });

  it('reports each component on its own: a dead API next to a listening app', async () => {
    const appPort = await freePort();
    const api = start('api', 'process.exit(1);');
    const app = start('app', `require('net').createServer().listen(${appPort}, '127.0.0.1');`);

    const outcome = await waitForStartup([
      { name: 'api', pid: api.pid, port: await freePort() },
      { name: 'app', pid: app.pid, port: appPort },
    ]);

    expect(outcome.failed.map((f) => f.name)).toEqual(['api']);
    expect(outcome.ready).toEqual(['app']);
  });

  it('a component whose start produced no process fails as not started (a failed compiled migration)', async () => {
    // `lt dev up --api-compiled` runs the migration itself and starts nothing when it fails.
    const outcome = await waitForStartup([{ name: 'api', pid: undefined, port: await freePort() }]);

    expect(outcome).toEqual({ failed: [{ name: 'api', pid: undefined, state: 'not-started' }], ready: [] });
  });

  it('does not watch a component without a port, and returns at once when nothing is left', async () => {
    const outcome = await waitForStartup([{ name: 'app', pid: 123, port: undefined }]);

    expect(outcome).toEqual({ failed: [], ready: [] });
  });
});
