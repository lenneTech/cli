import { CaddyGateDeps, ensureLtDevCaddy } from '../src/lib/dev-caddy-gate';

/** A gate whose every side effect is scripted; each test overrides what it is about. */
function gate(overrides: CaddyGateDeps) {
  const calls: string[] = [];
  const deps: CaddyGateDeps = {
    detectOwner: async () => {
      calls.push('detectOwner');
      return 'ours';
    },
    ensureFile: () => {
      calls.push('ensureFile');
      return false;
    },
    launchMode: 'service',
    portProblem: async () => null,
    prepare: async () => {
      calls.push('prepare');
      return { healed: false, running: true };
    },
    start: async () => {
      calls.push('start');
      return { logFile: '/home/x/.lenneTech/caddy.log', message: 'Started Caddy (pid 7).', ok: true };
    },
    systemCaddy: async () => null,
    ...overrides,
  };
  return { calls, run: () => ensureLtDevCaddy(deps) };
}

describe('ensureLtDevCaddy', () => {
  test('our running Caddy: ok, and a repaired Caddyfile is reported for the reload', async () => {
    const { run } = gate({ prepare: async () => ({ healed: true, running: true }) });
    expect(await run()).toEqual({ healed: true, lines: [], ok: true, started: false });
  });

  test('a foreign Caddy is refused with the commands, and nothing is started over it', async () => {
    const { calls, run } = gate({ detectOwner: async () => 'foreign', launchMode: 'on-demand' });
    const result = await run();
    expect(result).toMatchObject({ ok: false, reason: 'foreign', started: false });
    expect(result.lines.join('\n')).toContain('caddy reload --config');
    expect(calls).not.toContain('start');
  });

  test("Linux: a foreign Caddy that is the apt package's system service is named, with the one command", async () => {
    const { run } = gate({
      detectOwner: async () => 'foreign',
      systemCaddy: async () => ({ active: true, enabled: true }),
    });
    const text = (await run()).lines.join('\n');
    expect(text).toContain('caddy reload --config');
    expect(text).toContain("system service of Caddy's apt package (caddy.service)");
    expect(text).toContain('sudo systemctl disable --now caddy');
  });

  test('Linux without systemd: a start that fails on ports 80/443 names setcap', async () => {
    const { run } = gate({
      launchMode: 'on-demand',
      portProblem: async () => ({
        commands: ['sudo setcap cap_net_bind_service=+ep /usr/bin/caddy'],
        realBin: '/usr/bin/caddy',
        reason: '/usr/bin/caddy may not bind ports 80 and 443 as your user',
      }),
      prepare: async () => ({ healed: false, running: false }),
      start: async () => ({ logFile: '/home/x/.lenneTech/caddy.log', message: 'Caddy did not answer.', ok: false }),
    });
    const result = await run();
    expect(result.reason).toBe('start-failed');
    expect(result.lines).toContain('  sudo setcap cap_net_bind_service=+ep /usr/bin/caddy');
  });

  test('macOS/Linux without a running Caddy: the service owns it, so the answer is lt dev install', async () => {
    const { calls, run } = gate({ prepare: async () => ({ healed: false, running: false }) });
    const result = await run();
    expect(result).toMatchObject({ ok: false, reason: 'down' });
    expect(result.lines[0]).toContain('lt dev install');
    expect(calls).not.toContain('start');
  });

  test('Windows without a running Caddy: our Caddyfile first, then ours is started and must identify as ours', async () => {
    const { calls, run } = gate({ launchMode: 'on-demand', prepare: async () => ({ healed: true, running: false }) });
    // A Caddy started from the file it just loaded needs no reload, whatever the repair did.
    expect(await run()).toEqual({ healed: false, lines: [], ok: true, started: true });
    expect(calls).toEqual(['ensureFile', 'start', 'detectOwner']);
  });

  test('Windows: a start that fails says why and where the log is', async () => {
    const { run } = gate({
      launchMode: 'on-demand',
      prepare: async () => ({ healed: false, running: false }),
      start: async () => ({ logFile: 'C:\\log\\caddy.log', message: 'caddy not found on PATH.', ok: false }),
    });
    const result = await run();
    expect(result).toMatchObject({ ok: false, reason: 'start-failed' });
    expect(result.lines).toEqual(['caddy not found on PATH.', 'Log: C:\\log\\caddy.log']);
  });

  test('Windows: a Caddy that is gone again right after the start is a failed start', async () => {
    const { run } = gate({
      detectOwner: async () => 'none',
      launchMode: 'on-demand',
      prepare: async () => ({ healed: false, running: false }),
    });
    expect(await run()).toMatchObject({ ok: false, reason: 'start-failed', started: true });
  });

  test('a Caddy started by hand with our Caddyfile on Windows is used as it is', async () => {
    // The way lt dev up worked on Windows before `lt dev install` could start Caddy (DEV-3320).
    const { calls, run } = gate({ launchMode: 'on-demand' });
    expect(await run()).toMatchObject({ ok: true, started: false });
    expect(calls).not.toContain('start');
  });

  test('the service gets the time to restart after a repair; an on-demand Caddy has no one to restart it', async () => {
    const timeouts: Array<number | undefined> = [];
    const prepare = async (timeoutMs?: number) => {
      timeouts.push(timeoutMs);
      return { healed: false, running: true };
    };
    await gate({ launchMode: 'service', prepare }).run();
    await gate({ launchMode: 'on-demand', prepare }).run();
    expect(timeouts).toEqual([undefined, 0]);
  });

  test('where Caddy can only be started by hand, the command to start it is the answer', async () => {
    const { run } = gate({ launchMode: 'manual', prepare: async () => ({ healed: false, running: false }) });
    const result = await run();
    expect(result).toMatchObject({ ok: false, reason: 'down' });
    expect(result.lines[0]).toMatch(/caddy run --config ".*" --adapter caddyfile/);
  });
});
