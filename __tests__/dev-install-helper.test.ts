import { rmSync } from 'fs';

import { ExtendedGluegunToolbox } from '../src/interfaces/extended-gluegun-toolbox';
import { OWNER_LOGGER, readCaddyfile } from '../src/lib/caddy';
import { runInstall, RunInstallDeps } from '../src/lib/dev-install-helper';
import { DISABLE_SYSTEM_CADDY } from '../src/lib/dev-service';

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
    platform: 'win32',
    portProblem: async () => null,
    restartCaddy: async () => 'none',
    staleCapability: async () => false,
    systemCaddy: async () => null,
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

describe('runInstall on Linux and in WSL2', () => {
  beforeEach(() => {
    rmSync(process.env.LT_DEV_CADDYFILE as string, { force: true });
  });

  /** Linux without systemd (WSL2 default): Caddy on demand, like Windows. */
  function linuxOnDemand(overrides: Partial<RunInstallDeps> = {}) {
    const { calls, deps } = windows({ platform: 'linux', windowsTrust: async () => 'yes', wsl: false, ...overrides });
    return { calls, deps };
  }

  const problem = {
    commands: ['sudo setcap cap_net_bind_service=+ep /usr/bin/caddy'],
    realBin: '/usr/bin/caddy',
    reason: '/usr/bin/caddy may not bind ports 80 and 443 as your user',
  };

  test('no systemd: starts Caddy on demand and names the restart behaviour, not Windows', async () => {
    const { out, tb } = toolbox();
    const { calls, deps } = linuxOnDemand();
    const result = await runInstall(tb, {}, deps);
    expect(result.ok).toBe(true);
    expect(calls).toContain('start');
    const text = out.join('\n');
    expect(text).toContain('No systemd here, so no service');
    expect(text).not.toContain('Windows');
    expect(text).toContain('sudo -E HOME="$HOME" caddy trust');
  });

  test('in WSL it says how to get a service (wsl.conf + wsl --shutdown)', async () => {
    const { out, tb } = toolbox();
    const { deps } = linuxOnDemand({ wsl: true });
    await runInstall(tb, {}, deps);
    const text = out.join('\n');
    expect(text).toContain('/etc/wsl.conf');
    expect(text).toContain('systemd=true');
    expect(text).toContain('wsl --shutdown');
  });

  test('port 80/443 not allowed, nobody at the terminal: prints setcap and reports blocked', async () => {
    const { out, tb } = toolbox();
    const ran: string[][] = [];
    const { deps } = linuxOnDemand({
      interactive: false,
      portProblem: async () => problem,
      runInteractive: async (command, args) => {
        ran.push([command, ...args]);
        return 0;
      },
    });
    const result = await runInstall(tb, {}, deps);
    expect(result.blocked).toBe(true);
    expect(out.join('\n')).toContain('sudo setcap cap_net_bind_service=+ep /usr/bin/caddy');
    expect(ran).toEqual([]);
  });

  test('port 80/443 not allowed, the user agrees: runs sudo setcap on the real binary and checks again', async () => {
    const { out, tb } = toolbox();
    const ran: string[][] = [];
    let fixed = false;
    const { deps } = linuxOnDemand({
      confirm: async () => true,
      interactive: true,
      portProblem: async () => (fixed ? null : problem),
      runInteractive: async (command, args) => {
        ran.push([command, ...args]);
        fixed = true;
        return 0;
      },
    });
    const result = await runInstall(tb, {}, deps);
    expect(ran).toEqual([['sudo', 'setcap', 'cap_net_bind_service=+ep', '/usr/bin/caddy']]);
    expect(result.blocked).toBe(false);
    expect(out.join('\n')).toContain('caddy may bind ports 80 and 443');
  });

  test('after setcap, a Caddy that already runs is restarted: it keeps the capabilities it started with', async () => {
    const { out, tb } = toolbox();
    let fixed = false;
    const restarted: string[] = [];
    const { deps } = linuxOnDemand({
      confirm: async () => true,
      interactive: true,
      portProblem: async () => (fixed ? null : problem),
      restartCaddy: async () => {
        restarted.push('restart');
        return 'restarted';
      },
      runInteractive: async () => {
        fixed = true;
        return 0;
      },
    });
    await runInstall(tb, {}, deps);
    expect(restarted).toEqual(['restart']);
    expect(out.join('\n')).toContain("Restarted lt dev's Caddy");
  });

  test('setcap by hand while Caddy ran: install restarts that Caddy instead of reporting "Setup complete" over it', async () => {
    const { out, tb } = toolbox();
    const restarted: string[] = [];
    const { deps } = linuxOnDemand({
      portProblem: async () => null,
      restartCaddy: async () => {
        restarted.push('restart');
        return 'stopped';
      },
      staleCapability: async () => true,
    });
    const result = await runInstall(tb, {}, deps);
    expect(restarted).toEqual(['restart']);
    expect(out.join('\n')).toContain("Stopped lt dev's Caddy; it starts again with the capability.");
    expect(result.blocked).toBe(false);
  });

  test('a Caddy that already holds the capability is left running', async () => {
    const { tb } = toolbox();
    const restarted: string[] = [];
    const { deps } = linuxOnDemand({
      restartCaddy: async () => {
        restarted.push('restart');
        return 'restarted';
      },
      staleCapability: async () => false,
    });
    await runInstall(tb, {}, deps);
    expect(restarted).toEqual([]);
  });

  test("Caddy's apt package enabled its system service: named, and disabled with sudo when the user agrees", async () => {
    const { out, tb } = toolbox();
    const ran: string[][] = [];
    let disabled = false;
    const { deps } = linuxOnDemand({
      confirm: async () => true,
      interactive: true,
      runInteractive: async (command, args) => {
        ran.push([command, ...args]);
        disabled = true;
        return 0;
      },
      systemCaddy: async () => (disabled ? null : { active: false, enabled: true }),
    });
    const result = await runInstall(tb, {}, deps);
    expect(ran).toEqual([['sudo', 'systemctl', 'disable', '--now', 'caddy']]);
    expect(out.join('\n')).toContain('after the next restart it takes ports 2019 and 80');
    expect(out.join('\n')).toContain('Disabled the system service caddy.service');
    expect(result.blocked).toBe(false);
  });

  test('a running system caddy.service without a terminal: named as the foreign Caddy, nothing run', async () => {
    const { out, tb } = toolbox();
    const ran: string[][] = [];
    const { calls, deps } = linuxOnDemand({
      detectOwner: async () => 'foreign',
      interactive: false,
      runInteractive: async (command, args) => {
        ran.push([command, ...args]);
        return 0;
      },
      systemCaddy: async () => ({ active: true, enabled: true }),
    });
    const result = await runInstall(tb, {}, deps);
    const text = out.join('\n');
    expect(result.foreign).toBe(true);
    expect(text).toContain("It is the system service of Caddy's apt package (caddy.service)");
    expect(text).toContain(DISABLE_SYSTEM_CADDY);
    // Reported once: step 2c names it, the foreign-Caddy block does not repeat it (1.58.1 did).
    expect(text.split(DISABLE_SYSTEM_CADDY).length - 1).toBe(1);
    expect(ran).toEqual([]);
    expect(calls).not.toContain('start');
  });

  test('WSL: imports the Caddy root into Windows when the user agrees', async () => {
    const { out, tb } = toolbox();
    const imports: unknown[] = [];
    const { deps } = linuxOnDemand({
      confirm: async () => true,
      importWindowsRoot: async (_deps, options) => {
        imports.push(options ?? {});
        return { command: 'certutil.exe -user -addstore Root "C:\\x.crt"', message: 'Imported.', ok: true };
      },
      interactive: true,
      windowsTrust: async () => 'no',
      wsl: true,
    });
    await runInstall(tb, {}, deps);
    expect(imports).toEqual([{}]);
    expect(out.join('\n')).toContain('The browser runs on Windows and needs the CA there');
    expect(out.join('\n')).toContain('Imported.');
  });

  test('WSL without a terminal: prints the exact certutil command, imports nothing', async () => {
    const { out, tb } = toolbox();
    const imports: unknown[] = [];
    const { deps } = linuxOnDemand({
      importWindowsRoot: async (_deps, options) => {
        imports.push(options ?? {});
        return { command: 'certutil.exe -user -addstore Root "C:\\x.crt"', message: 'Run this.', ok: true };
      },
      interactive: false,
      windowsTrust: async () => 'no',
      wsl: true,
    });
    await runInstall(tb, {}, deps);
    expect(imports).toEqual([{ prepareOnly: true }]);
    expect(out.join('\n')).toContain('certutil.exe -user -addstore Root "C:\\x.crt"');
  });
});

