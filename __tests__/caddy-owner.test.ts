import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Our Caddyfile lives in a temp dir: nothing here may touch ~/.lenneTech or the
// Caddy daemon on :2019. Every owner check gets its answers injected.
const tmp = mkdtempSync(join(tmpdir(), 'lt-caddy-owner-'));
process.env.LT_DEV_CADDYFILE = join(tmp, 'Caddyfile');

import {
  detectCaddyOwner,
  ensureCaddyfile,
  ensureOwnerMarker,
  foreignCaddyLines,
  OWNER_LOGGER,
  readCaddyfile,
  upsertProjectBlock,
} from '../src/lib/caddy';
import { ensureOwnCaddy } from '../src/lib/dev-caddy-gate';
import { caddyLaunchMode, startCaddyOnDemand } from '../src/lib/dev-service';

afterAll(() => rmSync(tmp, { force: true, recursive: true }));

const marked = JSON.stringify({ logging: { logs: { [OWNER_LOGGER]: { writer: { output: 'discard' } } } } });
const answer = (body: string, status = 200) => async () => ({ body, status });

describe('detectCaddyOwner — by what is loaded, never by which process', () => {
  const noAdapt = async () => {
    throw new Error('adapt must not run when the marker already decides');
  };

  it('none when nothing answers on :2019', async () => {
    await expect(detectCaddyOwner({ adaptOwn: noAdapt, fetchConfig: async () => null })).resolves.toBe('none');
  });

  it('ours when the loaded config carries the owner marker', async () => {
    await expect(detectCaddyOwner({ adaptOwn: noAdapt, fetchConfig: answer(marked) })).resolves.toBe('ours');
  });

  it('foreign when something answers with an error status or no JSON', async () => {
    // "nothing readable" is not "nothing there": something holds the port.
    const adaptOwn = async () => ({});
    await expect(detectCaddyOwner({ adaptOwn, fetchConfig: answer('forbidden', 403) })).resolves.toBe('foreign');
    await expect(detectCaddyOwner({ adaptOwn, fetchConfig: answer('<html>') })).resolves.toBe('foreign');
  });

  it('ours without marker when the loaded config IS our adapted Caddyfile (pre-marker installs)', async () => {
    const loaded = JSON.stringify({ apps: { http: { servers: { srv0: { listen: [':443'] } } } } });
    // Same content, different key order: still the same config.
    const own = { apps: { http: { servers: { srv0: { listen: [':443'] } } } } };
    await expect(detectCaddyOwner({ adaptOwn: async () => own, fetchConfig: answer(loaded) })).resolves.toBe('ours');
  });

  it('foreign without marker when the loaded config differs from ours', async () => {
    const loaded = JSON.stringify({ apps: { http: { servers: { client: { listen: [':443'] } } } } });
    await expect(detectCaddyOwner({ adaptOwn: async () => ({}), fetchConfig: answer(loaded) })).resolves.toBe('foreign');
  });

  it('foreign when our Caddyfile cannot be adapted — no proof, no reload', async () => {
    await expect(
      detectCaddyOwner({ adaptOwn: async () => undefined, fetchConfig: answer('{"apps":{}}') }),
    ).resolves.toBe('foreign');
  });
});

describe('owner marker in the Caddyfile', () => {
  it('goes after the leading comments, as the global options block', () => {
    const out = ensureOwnerMarker('# header\n\nfoo.localhost {\n}\n');
    expect(out).toBe(`# header\n\n{\n\tlog ${OWNER_LOGGER} {\n\t\toutput discard\n\t}\n}\n\nfoo.localhost {\n}\n`);
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

  it('ensureCaddyfile keeps existing project blocks (install used to reset the file)', () => {
    writeFileSync(process.env.LT_DEV_CADDYFILE!, '# old\n# >>> lt-dev:demo >>>\ndemo.localhost {\n}\n# <<< lt-dev:demo <<<\n');
    ensureCaddyfile();
    const after = readFileSync(process.env.LT_DEV_CADDYFILE!, 'utf8');
    expect(after).toContain('# >>> lt-dev:demo >>>');
    expect(after).toContain(`log ${OWNER_LOGGER}`);
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
  const base = { available: async () => true, prepareCaddyfile: () => undefined };
  const never = async () => {
    throw new Error('must not start Caddy here');
  };

  it('ours → ok, nothing started', async () => {
    const gate = await ensureOwnCaddy({ startIfDown: true }, { ...base, detectOwner: async () => 'ours', start: never });
    expect(gate).toMatchObject({ ok: true, started: false });
  });

  it('foreign → refused with the diagnosis, and nothing is started over it', async () => {
    const gate = await ensureOwnCaddy(
      { startIfDown: true },
      { ...base, detectOwner: async () => 'foreign', launchMode: 'on-demand', start: never },
    );
    expect(gate).toMatchObject({ ok: false, reason: 'foreign' });
    expect(gate.lines.join('\n')).toContain('caddy reload --config');
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
        args: ['run', '--config', process.env.LT_DEV_CADDYFILE, '--adapter', 'caddyfile'],
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

describe('every write to the running Caddy is preceded by an owner check', () => {
  // `reloadCaddy` replaces the running Caddy's whole config and `stopCaddy` ends
  // it. A new call site that forgets to ask first would reload our config into a
  // client project's Caddy. This does not prove the order inside a file; it
  // catches the call site that never asks at all.
  it('each file calling reloadCaddy/stopCaddy also asks detectCaddyOwner or ensureOwnCaddy', () => {
    const { readdirSync } = require('fs');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'templates') walk(path);
        } else if (path.endsWith('.ts') && !path.endsWith(join('lib', 'caddy.ts'))) {
          const src = readFileSync(path, 'utf8');
          if (/\b(reloadCaddy|stopCaddy)\(/.test(src) && !/\b(detectCaddyOwner|ensureOwnCaddy)\(/.test(src)) {
            offenders.push(path);
          }
        }
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });
});
