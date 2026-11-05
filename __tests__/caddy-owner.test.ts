import { rmSync } from 'fs';

// caddy.ts reads LT_DEV_CADDYFILE when it is imported, and vitest evaluates every import
// before the first statement: only a hoisted block runs early enough.
const { tmp } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-caddy-owner-'));
  process.env.LT_DEV_CADDYFILE = path.join(dir, 'Caddyfile');
  return { tmp: dir };
});

import {
  CaddyOwnerDeps,
  detectCaddyOwner,
  ensureOwnerMarker,
  foreignCaddyLines,
  migrateCaddyfile,
  OWNER_LOGGER,
  readCaddyfile,
  reloadCaddy,
  removeLegacyLoopbackBind,
  stopOwnCaddy,
  writeCaddyfile,
} from '../src/lib/caddy';

/** One site the way `caddy adapt` renders an lt dev block (measured on caddy v2.11.2). */
const site = (host: string, port: number) => ({
  handle: [{ handler: 'subroute', routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `127.0.0.1:${port}` }] }] }] }],
  match: [{ host: [host] }],
  terminal: true,
});
const config = (...routes: unknown[]) => ({ apps: { http: { servers: { srv0: { listen: [':443'], routes } } } } });
const answer = (body: unknown, status = 200) => async () => ({
  body: typeof body === 'string' ? body : JSON.stringify(body),
  status,
});
const deps = (loaded: unknown, own: unknown, registry = { hosts: [] as string[], slugs: [] as string[] }): CaddyOwnerDeps => ({
  adaptOwn: async () => own,
  fetchConfig: answer(loaded),
  knownNames: () => registry,
});

describe('caddy ownership', () => {
  afterAll(() => {
    rmSync(tmp, { force: true, recursive: true });
  });

  describe('ensureOwnerMarker', () => {
    test('adds a global options block after the leading comments', () => {
      const out = ensureOwnerMarker('# header\n\n# >>> lt-dev:crm >>>\ncrm.localhost {\n}\n# <<< lt-dev:crm <<<\n');
      expect(out).toBe(
        [
          '# header',
          '',
          '{',
          `\tlog ${OWNER_LOGGER} {`,
          '\t\toutput discard',
          '\t}',
          '}',
          '',
          '# >>> lt-dev:crm >>>',
          'crm.localhost {',
          '}',
          '# <<< lt-dev:crm <<<',
          '',
        ].join('\n'),
      );
    });

    test('goes into an existing global options block, which must stay the first block', () => {
      const out = ensureOwnerMarker('# header\n{\n\temail me@test.com\n}\n\nsite.localhost {\n}\n');
      expect(out).toBe(
        `# header\n{\n\tlog ${OWNER_LOGGER} {\n\t\toutput discard\n\t}\n\temail me@test.com\n}\n\nsite.localhost {\n}\n`,
      );
    });

    test('is idempotent', () => {
      const once = ensureOwnerMarker('# header\n');
      expect(ensureOwnerMarker(once)).toBe(once);
    });

    test('every lt write carries it, and the 1.51.x default_bind still goes', () => {
      writeCaddyfile('{\n\tdefault_bind 127.0.0.1 [::1]\n}\n\nsite.localhost {\n}\n');
      const written = readCaddyfile();
      expect(written).toContain(`log ${OWNER_LOGGER}`);
      expect(written).not.toContain('default_bind');
      // One global block only: the emptied legacy one is dropped, the marker gets a fresh one.
      expect(written.match(/^\{$/gm)).toHaveLength(1);
      expect(migrateCaddyfile(written)).toBe(written);
    });

    test('a global block holding the marker is not dropped by the legacy cleanup', () => {
      const content = `{\n\tlog ${OWNER_LOGGER} {\n\t\toutput discard\n\t}\n\tdefault_bind 127.0.0.1 [::1]\n}\n`;
      expect(removeLegacyLoopbackBind(content)).toBe(`{\n\tlog ${OWNER_LOGGER} {\n\t\toutput discard\n\t}\n}\n`);
    });
  });

  describe('detectCaddyOwner', () => {
    test('none when nothing answers on :2019', async () => {
      expect(await detectCaddyOwner({ fetchConfig: async () => null })).toBe('none');
    });

    test('foreign when something answers without a readable config', async () => {
      expect(await detectCaddyOwner({ fetchConfig: answer('forbidden', 403) })).toBe('foreign');
      expect(await detectCaddyOwner({ fetchConfig: answer('<html>', 200) })).toBe('foreign');
    });

    test('ours when the loaded config carries the marker, whatever it serves', async () => {
      const loaded = { ...config(site('client.example', 8080)), logging: { logs: { [OWNER_LOGGER]: {} } } };
      expect(await detectCaddyOwner(deps(loaded, undefined))).toBe('ours');
    });

    test('ours when it serves nothing: replacing an empty config disturbs no one', async () => {
      expect(await detectCaddyOwner(deps(null, undefined))).toBe('ours');
      expect(await detectCaddyOwner(deps({}, undefined))).toBe('ours');
    });

    test('ours when it serves exactly the Caddyfile (every install from before the marker)', async () => {
      const own = config(site('crm.localhost', 4011), site('api.crm.localhost', 4010));
      expect(await detectCaddyOwner(deps(own, own))).toBe('ours');
    });

    test('ours with old routes after a failed reload: hosts of registered projects', async () => {
      // The file moved on (a new project, other ports); Caddy kept the config of its last good reload.
      const loaded = config(site('crm.localhost', 4011), site('shop.localhost', 4020));
      const own = config(site('crm.localhost', 4031), site('cms.localhost', 4040));
      const registry = { hosts: ['shop.localhost', 'api.shop.localhost'], slugs: ['shop'] };
      expect(await detectCaddyOwner(deps(loaded, own, registry))).toBe('ours');
    });

    test('ours for the ticket and test stacks of a registered project', async () => {
      const loaded = config(site('crm-2314.localhost', 4050), site('api.crm-test-2.localhost', 4510));
      expect(await detectCaddyOwner(deps(loaded, {}, { hosts: [], slugs: ['crm'] }))).toBe('ours');
    });

    test("a project's block in our Caddyfile makes its stacks known without a registry entry", async () => {
      writeCaddyfile('# >>> lt-dev:shop >>>\nshop.localhost {\n}\n# <<< lt-dev:shop <<<\n');
      const loaded = config(site('shop-2314.localhost', 4050), site('api.shop-test.localhost', 4510));
      expect(
        await detectCaddyOwner({ adaptOwn: async () => ({}), fetchConfig: answer(loaded) }),
      ).toBe('ours');
    });

    test('foreign as soon as it serves one host lt dev does not know', async () => {
      const loaded = config(site('crm.localhost', 4011), site('client.localhost', 8080));
      const own = config(site('crm.localhost', 4011));
      expect(await detectCaddyOwner(deps(loaded, own, { hosts: [], slugs: ['crm'] }))).toBe('foreign');
      // A slug is a prefix only up to a dash: `crmx` is not a stack of `crm`.
      expect(await detectCaddyOwner(deps(config(site('crmx.localhost', 1)), {}, { hosts: [], slugs: ['crm'] }))).toBe(
        'foreign',
      );
    });

    test('foreign for a site without a host: it answers for every name', async () => {
      const catchAll = { handle: [{ body: 'hi', handler: 'static_response' }] };
      expect(await detectCaddyOwner(deps(config(catchAll), {}))).toBe('foreign');
      const partly = { handle: [], match: [{ host: ['crm.localhost'] }, { path: ['/x'] }] };
      expect(await detectCaddyOwner(deps(config(partly), config(site('crm.localhost', 1))))).toBe('foreign');
    });

    test('foreign for an app lt dev never configures', async () => {
      const loaded = { apps: { layer4: { servers: {} } } };
      expect(await detectCaddyOwner(deps(loaded, {}))).toBe('foreign');
    });

    test('a Caddyfile that cannot be adapted still leaves the registry to decide', async () => {
      const loaded = config(site('crm.localhost', 4011));
      expect(await detectCaddyOwner(deps(loaded, undefined, { hosts: ['crm.localhost'], slugs: [] }))).toBe('ours');
      expect(await detectCaddyOwner(deps(loaded, undefined))).toBe('foreign');
    });
  });

  describe('acting on the running Caddy', () => {
    test('reloadCaddy never reaches a foreign Caddy', async () => {
      const run = vi.fn(async () => ({ exitCode: 0, ok: true, stderr: '', stdout: '' }));
      const result = await reloadCaddy({ detectOwner: async () => 'foreign', run });
      expect(run).not.toHaveBeenCalled();
      expect(result).toMatchObject({ foreign: true, ok: false });
      expect(result.stderr).toContain('caddy reload --config');
    });

    test('reloadCaddy reloads our own Caddy with our Caddyfile', async () => {
      const run = vi.fn(async () => ({ exitCode: 0, ok: true, stderr: '', stdout: '' }));
      await reloadCaddy({ detectOwner: async () => 'ours', run });
      expect(run).toHaveBeenCalledWith([
        'reload',
        '--config',
        process.env.LT_DEV_CADDYFILE,
        '--adapter',
        'caddyfile',
        '--address',
        process.env.LT_DEV_CADDY_ADMIN,
      ]);
    });

    test('stopOwnCaddy stops only our own Caddy', async () => {
      const run = vi.fn(async () => ({ exitCode: 0, ok: true, stderr: '', stdout: '' }));
      expect(await stopOwnCaddy({ detectOwner: async () => 'foreign', run })).toEqual({ owner: 'foreign' });
      expect(await stopOwnCaddy({ detectOwner: async () => 'none', run })).toEqual({ owner: 'none' });
      expect(run).not.toHaveBeenCalled();
      const stopped = await stopOwnCaddy({ detectOwner: async () => 'ours', run });
      expect(run).toHaveBeenCalledWith(['stop', '--address', process.env.LT_DEV_CADDY_ADMIN]);
      expect(stopped.owner).toBe('ours');
    });

    test('the advice for a foreign Caddy never says to stop it', () => {
      const lines = foreignCaddyLines('/x/Caddyfile').join('\n');
      expect(lines).toContain('caddy reload --config "/x/Caddyfile" --adapter caddyfile');
      expect(lines).toContain('replaces');
      expect(lines).not.toMatch(/\b(stop|kill|taskkill)\b/i);
    });
  });
});
