import { rmSync } from 'fs';

import { ExtendedGluegunToolbox } from '../src/interfaces/extended-gluegun-toolbox';
import { OWNER_LOGGER, readCaddyfile } from '../src/lib/caddy';
import { runInstall, RunInstallDeps } from '../src/lib/dev-install-helper';

/** A toolbox whose printers collect every line, so a test reads what the user would see. */
function toolbox(): { out: string[]; tb: ExtendedGluegunToolbox } {
  const out: string[] = [];
  const say = (s: string) => out.push(s);
  const identity = (s: string) => s;
  const tb = {
    print: {
      colors: { bold: identity, cyan: identity, dim: identity },
      error: say,
      info: say,
      success: say,
      warning: say,
    },
  } as unknown as ExtendedGluegunToolbox;
  return { out, tb };
}

const okResult = { exitCode: 0, ok: true, stderr: '', stdout: '' };

/** Windows with caddy on PATH; each test overrides the part it is about. */
function windows(overrides: Partial<RunInstallDeps> = {}) {
  const calls: string[] = [];
  const deps: RunInstallDeps = {
    available: async () => true,
    detectOwner: async () => 'none',
    launchMode: 'on-demand',
    reload: async () => {
      calls.push('reload');
      return okResult;
    },
    start: async () => {
      calls.push('start');
      return { logFile: 'C:\\Users\\x\\.lenneTech\\caddy.log', message: 'Started Caddy (pid 7).', ok: true };
    },
    validate: async () => okResult,
    ...overrides,
  };
  return { calls, deps };
}

describe('runInstall', () => {
  beforeEach(() => {
    rmSync(process.env.LT_DEV_CADDYFILE as string, { force: true });
  });

  test('Windows: creates the Caddyfile with the owner marker and starts Caddy', async () => {
    const { out, tb } = toolbox();
    const { calls, deps } = windows();
    const result = await runInstall(tb, {}, deps);

    expect(result).toEqual({ blocked: false, caddyMissing: false, ok: true, unsupported: false });
    expect(calls).toEqual(['start']);
    expect(readCaddyfile()).toContain(`log ${OWNER_LOGGER}`);
    const text = out.join('\n');
    expect(text).toContain('Started Caddy (pid 7).');
    // No sudo on Windows, and no HOME juggling.
    expect(text).toContain('caddy trust');
    expect(text).not.toContain('sudo');
    expect(text).not.toMatch(/not supported/);
  });

  test('Windows: a Caddy that is already ours is used, not started a second time', async () => {
    const { out, tb } = toolbox();
    const { calls, deps } = windows({ detectOwner: async () => 'ours' });
    const result = await runInstall(tb, {}, deps);

    expect(result.ok).toBe(true);
    expect(calls).not.toContain('start');
    // The Caddyfile was just created, so our running Caddy reloads it and carries the marker.
    expect(calls).toContain('reload');
    expect(out.join('\n')).toContain('already running');
  });

  test('a foreign Caddy is refused: nothing started, nothing reloaded', async () => {
    for (const launchMode of ['on-demand', 'service'] as const) {
      const { out, tb } = toolbox();
      const { calls, deps } = windows({ detectOwner: async () => 'foreign', launchMode });
      const result = await runInstall(tb, {}, deps);

      expect(result).toMatchObject({ blocked: true, foreign: true, ok: false });
      expect(calls).toEqual([]);
      expect(out.join('\n')).toContain('caddy reload --config');
    }
  });

  test('Windows: a failed start leaves the setup blocked, with the log path', async () => {
    const { out, tb } = toolbox();
    const { deps } = windows({
      start: async () => ({ logFile: 'C:\\log\\caddy.log', message: 'Could not start caddy.exe.', ok: false }),
    });
    const result = await runInstall(tb, {}, deps);

    expect(result).toMatchObject({ blocked: true, ok: false });
    expect(out.join('\n')).toContain('C:\\log\\caddy.log');
  });

  test('Windows: missing caddy names the Windows install command', async () => {
    const { out, tb } = toolbox();
    const { calls, deps } = windows({ available: async () => false });
    const result = await runInstall(tb, {}, deps);

    expect(result).toMatchObject({ blocked: true, caddyMissing: true });
    expect(calls).toEqual([]);
    expect(out.join('\n')).toContain('winget install CaddyServer.Caddy');
  });

  test('where lt dev cannot start Caddy, it says so and touches nothing', async () => {
    const { tb } = toolbox();
    const { calls, deps } = windows({ launchMode: 'manual' });
    expect(await runInstall(tb, {}, deps)).toMatchObject({ blocked: true, unsupported: true });
    expect(calls).toEqual([]);
    expect(readCaddyfile()).toBe('');
  });
});
