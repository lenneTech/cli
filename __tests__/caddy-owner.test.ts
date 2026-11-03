import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Our Caddyfile lives in a temp dir: nothing here may touch ~/.lenneTech or the
// Caddy daemon on :2019. Every owner check gets its answers injected.
const tmp = mkdtempSync(join(tmpdir(), 'lt-caddy-owner-'));
process.env.LT_DEV_CADDYFILE = join(tmp, 'Caddyfile');

import {
  type CaddyResult,
  detectCaddyOwner,
  ensureCaddyfile,
  ensureOwnerMarker,
  foreignCaddyLines,
  healCaddyfile,
  migrateCaddyfile,
  OWNER_LOGGER,
  readCaddyfile,
  removeProjectBlock,
  renderProjectBlock,
  upsertProjectBlock,
} from '../src/lib/caddy';
import { ensureOwnCaddy, startOwnCaddy } from '../src/lib/dev-caddy-gate';
import { diagnoseCaddy } from '../src/lib/dev-doctor-caddy';
import { caddyLaunchMode, startCaddyOnDemand } from '../src/lib/dev-service';

afterAll(() => rmSync(tmp, { force: true, recursive: true }));

const CADDYFILE = process.env.LT_DEV_CADDYFILE as string;
const MARKER_BLOCK = `{\n\tlog ${OWNER_LOGGER} {\n\t\toutput discard\n\t}\n}`;
const marked = JSON.stringify({ logging: { logs: { [OWNER_LOGGER]: { writer: { output: 'discard' } } } } });
const answer =
  (body: string, status = 200) =>
  async () => ({ body, status });
const adapted = (stdout: string) => async (): Promise<CaddyResult> => ({ exitCode: 0, ok: true, stderr: '', stdout });
const ok: CaddyResult = { exitCode: 0, ok: true, stderr: '', stdout: '' };

describe('detectCaddyOwner — by what is loaded, never by which process', () => {
  const noAdapt = async (): Promise<CaddyResult> => {
    throw new Error('adapt must not run when the marker already decides');
  };

  it('none when nothing answers on :2019', async () => {
    await expect(detectCaddyOwner({ adapt: noAdapt, fetchConfig: async () => null })).resolves.toBe('none');
  });

  it('ours when the loaded config carries the owner marker', async () => {
    await expect(detectCaddyOwner({ adapt: noAdapt, fetchConfig: answer(marked) })).resolves.toBe('ours');
  });

  it('foreign when something answers with an error status or no JSON', async () => {
    // "nothing readable" is not "nothing there": something holds the port.
    const adapt = adapted('{}');
    await expect(detectCaddyOwner({ adapt, fetchConfig: answer('forbidden', 403) })).resolves.toBe('foreign');
    await expect(detectCaddyOwner({ adapt, fetchConfig: answer('<html>') })).resolves.toBe('foreign');
  });

  it('ours without marker when the loaded config IS our adapted Caddyfile (pre-marker installs)', async () => {
    const loaded = JSON.stringify({ apps: { http: { servers: { srv0: { listen: [':443'] } } } } });
    // Same content, different key order: still the same config.
    const own = JSON.stringify({ apps: { http: { servers: { srv0: { listen: [':443'] } } } } });
    await expect(detectCaddyOwner({ adapt: adapted(own), fetchConfig: answer(loaded) })).resolves.toBe('ours');
  });

  it('foreign without marker when the loaded config differs from ours', async () => {
    const loaded = JSON.stringify({ apps: { http: { servers: { client: { listen: [':443'] } } } } });
    await expect(detectCaddyOwner({ adapt: adapted('{}'), fetchConfig: answer(loaded) })).resolves.toBe('foreign');
  });

  it('foreign when our Caddyfile cannot be adapted — no proof, no reload', async () => {
    const failed = async (): Promise<CaddyResult> => ({ exitCode: 1, ok: false, stderr: 'adapt: bad', stdout: '' });
    await expect(detectCaddyOwner({ adapt: failed, fetchConfig: answer('{"apps":{}}') })).resolves.toBe('foreign');
  });

  it('measured values: our stub is `{}` on both sides, a config-less `caddy run` serves `null` and is foreign', async () => {
    // caddy v2.11.3: `caddy adapt` of the stub → `{}`; a Caddy run with the stub → `{}`;
    // a Caddy run without any config → `null`.
    await expect(detectCaddyOwner({ adapt: adapted('{}'), fetchConfig: answer('{}') })).resolves.toBe('ours');
    await expect(detectCaddyOwner({ adapt: adapted('{}'), fetchConfig: answer('null') })).resolves.toBe('foreign');
  });
});

describe('owner marker in the Caddyfile', () => {
  beforeEach(() => rmSync(CADDYFILE, { force: true }));

  it('goes after the leading comments, as the global options block', () => {
    const out = ensureOwnerMarker('# header\n\nfoo.localhost {\n}\n');
    expect(out).toBe(`# header\n\n${MARKER_BLOCK}\n\nfoo.localhost {\n}\n`);
  });

  it('goes INTO an existing global block — a second one would be invalid', () => {
    const out = ensureOwnerMarker('# h\n{\n\temail a@b.c\n}\n\nfoo.localhost {\n}\n');
    expect(out.match(/^\{$/gm)).toHaveLength(1);
    expect(out).toContain(`{\n\tlog ${OWNER_LOGGER} {\n\t\toutput discard\n\t}\n\temail a@b.c\n}`);
  });

  it('is idempotent', () => {
    const once = ensureOwnerMarker('# h\n');
    expect(ensureOwnerMarker(once)).toBe(once);
  });

  it('every write carries it exactly once', () => {
    upsertProjectBlock('demo', [{ hostname: 'demo.localhost', upstreamPort: 4000 }]);
    upsertProjectBlock('other', [{ hostname: 'other.localhost', upstreamPort: 4001 }]);
    expect(readCaddyfile().split(`log ${OWNER_LOGGER}`)).toHaveLength(2);
  });

  it('never lands inside a project block, so removing the block keeps it', () => {
    // A file that starts with a project block (upsert into a missing file writes no header):
    // the block's `# >>>` line is a comment, but it is not a LEADING comment.
    upsertProjectBlock('demo', [{ hostname: 'demo.localhost', upstreamPort: 4000 }]);
    const text = readCaddyfile();
    expect(text.indexOf(`log ${OWNER_LOGGER}`)).toBeLessThan(text.indexOf('# >>> lt-dev:demo >>>'));
    expect(removeProjectBlock('demo')).toBe(true);
    expect(readCaddyfile()).toContain(`log ${OWNER_LOGGER}`);
  });

  it('ensureCaddyfile keeps existing project blocks (install used to reset the file)', () => {
    writeFileSync(CADDYFILE, '# old\n# >>> lt-dev:demo >>>\ndemo.localhost {\n}\n# <<< lt-dev:demo <<<\n');
    expect(ensureCaddyfile()).toBe(true);
    const after = readFileSync(CADDYFILE, 'utf8');
    expect(after).toContain('# >>> lt-dev:demo >>>');
    expect(after).toContain(`log ${OWNER_LOGGER}`);
    expect(ensureCaddyfile()).toBe(false);
  });

  it('is one step of the migration, with the 1.51.x repair and the guards: one write, all three', () => {
    // A 1.51.0/1.51.1 Caddyfile: lt's default_bind and a block rendered before the per-site guard.
    const legacy = `# lt dev\n\n{\n\tdefault_bind 127.0.0.1 [::1]\n}\n\n# >>> lt-dev:kit >>>\nkit.localhost {\n  reverse_proxy 127.0.0.1:4009\n}\n# <<< lt-dev:kit <<<\n`;
    writeFileSync(CADDYFILE, legacy);
    expect(healCaddyfile()).toBe(true);
    const healed = readCaddyfile();
    expect(healed).not.toMatch(/default_bind/);
    expect(healed).toContain('kit.localhost {\n  @lt_remote not remote_ip 127.0.0.0/8 ::1\n  abort @lt_remote\n');
    expect(healed.split(`log ${OWNER_LOGGER}`)).toHaveLength(2);
    expect(healed.match(/^\{$/gm)).toHaveLength(1);
    expect(migrateCaddyfile(healed)).toBe(healed);
  });

  it('survives the 1.51.x repair when it shares the global block with the default_bind', () => {
    const shared = `# lt dev\n\n{\n\tlog ${OWNER_LOGGER} {\n\t\toutput discard\n\t}\n\tdefault_bind 127.0.0.1 [::1]\n}\n`;
    expect(migrateCaddyfile(shared)).toBe(`# lt dev\n\n${MARKER_BLOCK}\n`);
  });

  it('is not mistaken for a site block by the loopback guard', () => {
    const block = renderProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]);
    const out = migrateCaddyfile(`# h\n\n${block}\n`);
    expect(out.match(/@lt_remote not remote_ip/g)).toHaveLength(1);
  });
});

describe('foreignCaddyLines', () => {
  it('names our Caddyfile and how to load or run it', () => {
    const text = foreignCaddyLines('/x/Caddyfile').join('\n');
    expect(text).toContain('caddy reload --config "/x/Caddyfile" --adapter caddyfile');
    expect(text).toContain('caddy run --config "/x/Caddyfile" --adapter caddyfile');
  });

  it('never tells anyone to stop or kill their Caddy', () => {
    expect(foreignCaddyLines('/x').join('\n')).not.toMatch(/\bstop\b|kill|Stop-Process|taskkill/i);
  });
});

describe('ensureOwnCaddy — the one gate every command uses', () => {
  const never = async (): Promise<never> => {
    throw new Error('must not happen here');
  };
  const base = {
    available: async () => true,
    heal: () => false,
    prepareCaddyfile: () => undefined,
    reload: never,
    waitReady: never,
  };

  it('ours → ok, nothing started, nothing reloaded when nothing was repaired', async () => {
    const gate = await ensureOwnCaddy(
      { startIfDown: true },
      { ...base, detectOwner: async () => 'ours', start: never },
    );
    expect(gate).toMatchObject({ ok: true, started: false });
  });

  it('asks whose Caddy it is BEFORE it repairs the Caddyfile', async () => {
    // A pre-marker instance is ours only while its config matches the file; the repair changes
    // what the file adapts to (guards, marker).
    const calls: string[] = [];
    await ensureOwnCaddy(
      { startIfDown: false },
      {
        ...base,
        detectOwner: async () => {
          calls.push('detect');
          return 'ours';
        },
        heal: () => {
          calls.push('heal');
          return false;
        },
      },
    );
    expect(calls).toEqual(['detect', 'heal']);
  });

  it('ours + repaired → reloads once, so the next check still recognises it', async () => {
    let reloads = 0;
    const gate = await ensureOwnCaddy(
      { startIfDown: false },
      {
        ...base,
        detectOwner: async () => 'ours',
        heal: () => true,
        reload: async () => {
          reloads++;
          return ok;
        },
      },
    );
    expect(gate).toMatchObject({ ok: true, started: false });
    expect(reloads).toBe(1);
  });

  it('ours + repaired, but the reload fails → a failure with the error, not ok', async () => {
    const gate = await ensureOwnCaddy(
      { startIfDown: false },
      {
        ...base,
        detectOwner: async () => 'ours',
        heal: () => true,
        reload: async () => ({
          exitCode: 1,
          ok: false,
          stderr: 'listen tcp: bind: permission denied\nmore',
          stdout: '',
        }),
      },
    );
    expect(gate).toMatchObject({ ok: false, reason: 'reload-failed' });
    expect(gate.lines[0]).toContain('bind: permission denied');
  });

  it('foreign → refused with the diagnosis; our file is repaired, their Caddy is not reloaded', async () => {
    let healed = 0;
    const gate = await ensureOwnCaddy(
      { startIfDown: true },
      {
        ...base,
        detectOwner: async () => 'foreign',
        heal: () => {
          healed++;
          return true;
        },
        launchMode: 'on-demand',
        start: never,
      },
    );
    expect(gate).toMatchObject({ ok: false, reason: 'foreign' });
    expect(gate.lines.join('\n')).toContain('caddy reload --config');
    expect(healed).toBe(1);
  });

  it('recognises a pre-marker Caddy although the repair changes the file (real migration, real file)', async () => {
    // What a Caddy from before 1.51.2 loaded: the file as it is now, with neither the loopback
    // guard nor the owner marker. The fake adapt maps the CURRENT file to JSON, as `caddy adapt` would.
    writeFileSync(
      CADDYFILE,
      `# lt dev\n\n${renderProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]).replace(/\n {2}@lt_remote.*\n {2}abort @lt_remote/, '')}\n`,
    );
    const fakeAdapt = async (): Promise<CaddyResult> => ({ ...ok, stdout: JSON.stringify({ file: readCaddyfile() }) });
    const loadedBefore = JSON.stringify({ file: readCaddyfile() });
    let reloads = 0;
    const gate = await ensureOwnCaddy(
      { startIfDown: false },
      {
        ...base,
        detectOwner: () => detectCaddyOwner({ adapt: fakeAdapt, fetchConfig: answer(loadedBefore) }),
        heal: healCaddyfile,
        reload: async () => {
          reloads++;
          return ok;
        },
      },
    );
    expect(gate).toMatchObject({ ok: true });
    expect(reloads).toBe(1);
    expect(readCaddyfile()).toContain(`log ${OWNER_LOGGER}`);
    expect(readCaddyfile()).toContain('abort @lt_remote');
    // The same Caddy, asked AFTER the repair, would no longer match: the order is what saves it.
    await expect(detectCaddyOwner({ adapt: fakeAdapt, fetchConfig: answer(loadedBefore) })).resolves.toBe('foreign');
  });

  it('none on Windows → starts ours, and only accepts it once it identifies as ours', async () => {
    const owners = ['none', 'ours'] as const;
    let i = 0;
    let started = 0;
    const gate = await ensureOwnCaddy(
      { startIfDown: true },
      {
        ...base,
        detectOwner: async () => owners[i++],
        launchMode: 'on-demand',
        start: async () => {
          started++;
          return { logFile: 'l', message: 'm', ok: true };
        },
      },
    );
    expect(gate).toMatchObject({ ok: true, started: true });
    expect(started).toBe(1);
  });

  it('none on Windows, but something foreign took :2019 meanwhile → refused', async () => {
    const owners = ['none', 'foreign'] as const;
    let i = 0;
    const gate = await ensureOwnCaddy(
      { startIfDown: true },
      {
        ...base,
        detectOwner: async () => owners[i++],
        launchMode: 'on-demand',
        start: async () => ({ logFile: 'l', message: 'm', ok: true }),
      },
    );
    expect(gate).toMatchObject({ ok: false, reason: 'foreign' });
  });

  it('none on Windows without startIfDown → down, pointing at `lt dev up`', async () => {
    const gate = await ensureOwnCaddy(
      { startIfDown: false },
      { ...base, detectOwner: async () => 'none', launchMode: 'on-demand', start: never },
    );
    expect(gate).toMatchObject({ ok: false, reason: 'down' });
    expect(gate.lines[0]).toContain('lt dev up');
  });

  it('none with a service (macOS/Linux) → never starts it itself, points at `lt dev install`', async () => {
    const gate = await ensureOwnCaddy(
      { startIfDown: true },
      { ...base, detectOwner: async () => 'none', launchMode: 'service', start: never },
    );
    expect(gate).toMatchObject({ ok: false, reason: 'down' });
    expect(gate.lines[0]).toContain('lt dev install');
  });

  it('none with a service after a repair → waits for the service manager to restart it', async () => {
    // The 1.51.x default_bind kept Caddy from starting on macOS at all; KeepAlive brings it back
    // once the file binds. Checking first and stopping there would never let the machine heal.
    const owners = ['none', 'ours'] as const;
    let i = 0;
    const waited: number[] = [];
    const gate = await ensureOwnCaddy(
      { startIfDown: true },
      {
        ...base,
        detectOwner: async () => owners[i++],
        heal: () => true,
        launchMode: 'service',
        start: never,
        waitReady: async (ms) => {
          waited.push(ms);
          return true;
        },
      },
    );
    expect(gate).toMatchObject({ ok: true, started: false });
    expect(waited).toEqual([20_000]);
  });

  it('a failed start is a failure, with the log', async () => {
    const gate = await ensureOwnCaddy(
      { startIfDown: true },
      {
        ...base,
        detectOwner: async () => 'none',
        launchMode: 'on-demand',
        start: async () => ({ logFile: '/log', message: 'boom', ok: false }),
      },
    );
    expect(gate).toMatchObject({ ok: false, reason: 'start-failed' });
    expect(gate.lines.join('\n')).toContain('/log');
  });

  it('startOwnCaddy (install) makes sure the Caddyfile exists before it starts Caddy', async () => {
    const calls: string[] = [];
    const gate = await startOwnCaddy({
      detectOwner: async () => {
        calls.push('detect');
        return 'ours';
      },
      prepareCaddyfile: () => calls.push('prepare'),
      start: async () => {
        calls.push('start');
        return { logFile: 'l', message: 'm', ok: true };
      },
    });
    expect(gate).toMatchObject({ ok: true, started: true });
    expect(calls).toEqual(['prepare', 'start', 'detect']);
  });
});

describe('lt dev doctor — the ownership check and the loaded-config check agree', () => {
  const never = async (): Promise<never> => {
    throw new Error('must not run');
  };
  const valid = async (): Promise<CaddyResult> => ok;

  it('foreign → one FAIL, and its config is NOT compared with ours (no "reload failed", no caddy reload)', async () => {
    const d = await diagnoseCaddy(true, {
      compareLoaded: never,
      detectOwner: async () => 'foreign',
      readCaddyfile: () => '# lt dev\n',
      validate: valid,
    });
    const text = d.lines.map((l) => l.msg).join('\n');
    expect(text).toContain('not started by lt dev');
    expect(text).not.toMatch(/reload/);
    expect(d.fails).toBe(1);
  });

  it('ours, but the loaded config differs → the 1.51.4 FAIL, counted once', async () => {
    const d = await diagnoseCaddy(true, {
      compareLoaded: async () => 'differs',
      detectOwner: async () => 'ours',
      readCaddyfile: () => '# lt dev\n',
      validate: valid,
    });
    const text = d.lines.map((l) => l.msg).join('\n');
    expect(text).toContain('the last reload failed');
    expect(text).toContain('caddy reload --config');
    expect(d.fails).toBe(1);
  });

  it('foreign while our file still has the 1.51.x default_bind → says it may be our stuck Caddy', async () => {
    const d = await diagnoseCaddy(true, {
      compareLoaded: never,
      detectOwner: async () => 'foreign',
      platform: 'darwin',
      readCaddyfile: () => '{\n\tdefault_bind 127.0.0.1 [::1]\n}\n',
      validate: valid,
    });
    const text = d.lines.map((l) => l.msg).join('\n');
    expect(text).toContain('failed reloads of lt 1.51.0/1.51.1');
    expect(text).toContain('default_bind 127.0.0.1 [::1]');
    expect(d.fails).toBe(2);
  });

  it('Windows, nothing running → INFO, not a failure (`lt dev up` starts it)', async () => {
    const d = await diagnoseCaddy(true, {
      compareLoaded: never,
      detectOwner: async () => 'none',
      launchMode: 'on-demand',
      readCaddyfile: () => '',
      validate: valid,
    });
    expect(d.fails).toBe(0);
    expect(d.lines[0]).toMatchObject({ tag: 'INFO' });
  });
});

describe('Caddy launch on each platform', () => {
  it('service on macOS/Linux, on demand on Windows, manual elsewhere', () => {
    expect(caddyLaunchMode('darwin')).toBe('service');
    expect(caddyLaunchMode('linux')).toBe('service');
    expect(caddyLaunchMode('win32')).toBe('on-demand');
    expect(caddyLaunchMode('freebsd')).toBe('manual');
  });

  it('startCaddyOnDemand runs `caddy run` with OUR Caddyfile, logging to a file', async () => {
    const calls: { args: string[]; cmd: string; logFile: string }[] = [];
    const result = await startCaddyOnDemand({
      resolveBin: async () => 'C:\\caddy\\caddy.exe',
      spawn: (cmd, args, opts) => {
        calls.push({ args, cmd, logFile: opts.logFile });
        return { pid: 4242, rotated: { rotated: false } };
      },
      waitReady: async () => true,
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        args: ['run', '--config', CADDYFILE, '--adapter', 'caddyfile'],
        cmd: 'C:\\caddy\\caddy.exe',
        logFile: expect.stringMatching(/caddy\.log$/),
      },
    ]);
  });

  it('startCaddyOnDemand reports a Caddy that never answers as a failure', async () => {
    const result = await startCaddyOnDemand({
      resolveBin: async () => 'caddy',
      spawn: () => ({ pid: 1, rotated: { rotated: false } }),
      waitReady: async () => false,
    });
    expect(result.ok).toBe(false);
  });
});

describe('every write is preceded by an owner check', () => {
  // A static guard: it does not prove the order inside a file (the gate tests above do that), it
  // catches the call site that never asks at all.
  const offenders = (calls: RegExp): string[] => {
    const { readdirSync } = require('fs');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'templates') walk(path);
        } else if (path.endsWith('.ts') && !path.endsWith(join('lib', 'caddy.ts'))) {
          const src = readFileSync(path, 'utf8');
          if (calls.test(src) && !/\b(detectCaddyOwner|ensureOwnCaddy)\(/.test(src)) found.push(path);
        }
      }
    };
    walk(join(__dirname, '..', 'src'));
    return found;
  };

  it('each file calling reloadCaddy/stopCaddy also asks detectCaddyOwner or ensureOwnCaddy', () => {
    // `reloadCaddy` replaces the running Caddy's whole config and `stopCaddy` ends it. A new
    // call site that forgets to ask first would reload our config into a client project's Caddy.
    expect(offenders(/\b(reloadCaddy|stopCaddy)\(/)).toEqual([]);
  });

  it('each file writing the Caddyfile also asks — a write before the check loses a pre-marker Caddy', () => {
    // Every writer runs `migrateCaddyfile`, which changes what the file adapts to. A command that
    // wrote first would make our own pre-marker Caddy look foreign to the check that follows.
    expect(
      offenders(/\b(ensureCaddyfile|healCaddyfile|removeProjectBlock|upsertProjectBlock|writeCaddyfile)\(/),
    ).toEqual([]);
  });
});
