import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'lt-caddy-'));
process.env.LT_DEV_CADDYFILE = join(tmp, 'Caddyfile');

import {
  addLoopbackGuards,
  compareLoadedConfig,
  ensureCaddyfile,
  hasLegacyLoopbackBind,
  healCaddyfile,
  migrateCaddyfile,
  readCaddyfile,
  removeLegacyLoopbackBind,
  removeProjectBlock,
  renderProjectBlock,
  sameCaddyConfig,
  upsertProjectBlock,
  writeCaddyfile,
} from '../src/lib/caddy';

describe('caddy / Caddyfile management', () => {
  beforeEach(() => {
    writeCaddyfile('# clean slate\n');
  });
  afterAll(() => {
    rmSync(tmp, { force: true, recursive: true });
  });

  describe('renderProjectBlock', () => {
    test('produces a markered block per route', () => {
      const block = renderProjectBlock('crm', [
        { hostname: 'crm.localhost', upstreamPort: 4011 },
        { hostname: 'api.crm.localhost', upstreamPort: 4010 },
      ]);
      expect(block).toContain('# >>> lt-dev:crm >>>');
      expect(block).toContain('crm.localhost {');
      expect(block).toContain('reverse_proxy 127.0.0.1:4011');
      expect(block).toContain('api.crm.localhost {');
      expect(block).toContain('reverse_proxy 127.0.0.1:4010');
      expect(block).toContain('# <<< lt-dev:crm <<<');
    });

    test('upstream is `127.0.0.1` (paired with HOST=127.0.0.1 in dev-env) — never `localhost`, never `[::1]`', () => {
      // Regression: `localhost` as upstream resolves to `::1` first on
      // macOS, which can land in a stray IPv6 listener (HMR, vite-proxy,
      // a different process) and hang the request. `HOST=127.0.0.1` in
      // dev-env pins the dev servers to IPv4, so a `127.0.0.1` upstream
      // is unambiguous.
      const block = renderProjectBlock('shop', [{ hostname: 'shop.localhost', upstreamPort: 4021 }]);
      expect(block).toContain('reverse_proxy 127.0.0.1:4021');
      expect(block).not.toMatch(/reverse_proxy\s+localhost/);
      expect(block).not.toMatch(/reverse_proxy\s+\[::1]/);
    });

    test('caps the upstream connections of every route below the OS accept queue', () => {
      // Regression: a cold `nuxt dev` serves ~800 raw modules on the first page
      // load. The browser multiplexes them over one HTTP/2 connection, Caddy
      // fanned them out into as many upstream dials, the dev server's accept
      // queue (macOS `somaxconn` = 128) overflowed, and the excess got
      // `connect: connection reset by peer` → 502 → the page never hydrated.
      const block = renderProjectBlock('crm', [
        { hostname: 'crm.localhost', upstreamPort: 4011 },
        { hostname: 'api.crm.localhost', upstreamPort: 4010 },
      ]);
      const limits = [...block.matchAll(/max_conns_per_host (\d+)/g)].map((match) => Number(match[1]));
      expect(limits).toHaveLength(2);
      for (const limit of limits) {
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThan(128);
      }
      expect(block).toMatch(/reverse_proxy 127\.0\.0\.1:4011 \{\n\s+transport http \{\n\s+max_conns_per_host \d+\n\s+\}\n\s+\}/);
    });
  });

  describe('upsertProjectBlock', () => {
    test('inserts a new block', () => {
      const changed = upsertProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]);
      expect(changed).toBe(true);
      expect(readCaddyfile()).toContain('# >>> lt-dev:crm >>>');
    });
    test('replaces an existing block in place', () => {
      upsertProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]);
      upsertProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4099 }]);
      const out = readCaddyfile();
      const matches = out.match(/# >>> lt-dev:crm >>>/g);
      expect(matches?.length).toBe(1);
      expect(out).toContain('reverse_proxy 127.0.0.1:4099');
      expect(out).not.toContain('4011');
    });
    test('multiple projects coexist', () => {
      upsertProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]);
      upsertProjectBlock('shop', [{ hostname: 'shop.localhost', upstreamPort: 4021 }]);
      const out = readCaddyfile();
      expect(out).toContain('# >>> lt-dev:crm >>>');
      expect(out).toContain('# >>> lt-dev:shop >>>');
    });
    test('idempotent on identical re-apply', () => {
      const c1 = upsertProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]);
      const c2 = upsertProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]);
      expect(c1).toBe(true);
      expect(c2).toBe(false);
    });
  });

  // Every site block answers only this machine. A global `default_bind 127.0.0.1 [::1]` (CLI
  // 1.51.0/1.51.1) did the same on paper and broke `lt dev` on every Mac: macOS binds a port
  // below 1024 for an unprivileged process only on the wildcard address, so each reload failed
  // with "listen tcp 127.0.0.1:443: bind: permission denied". `caddy validate` never binds.
  describe('loopback only', () => {
    const LEGACY = 'default_bind 127.0.0.1 [::1]';
    const routes = [
      { hostname: 'crm.localhost', upstreamPort: 4011 },
      { hostname: 'api.crm.localhost', upstreamPort: 4010 },
    ];

    test('every site block aborts connections that do not come from this machine', () => {
      const block = renderProjectBlock('crm', routes);
      const sites = block.split(/\n(?=\S+\.localhost \{)/).filter((part) => part.includes('.localhost {'));
      expect(sites).toHaveLength(2);
      for (const site of sites) {
        expect(site).toContain('@lt_remote not remote_ip 127.0.0.0/8 ::1');
        expect(site.indexOf('abort @lt_remote')).toBeGreaterThan(-1);
        expect(site.indexOf('abort @lt_remote')).toBeLessThan(site.indexOf('reverse_proxy'));
      }
    });

    test('never writes a default_bind (a specific address below 1024 needs root on macOS)', () => {
      writeCaddyfile('# lt dev — managed Caddyfile\n');
      upsertProjectBlock('crm', routes);
      expect(readCaddyfile()).not.toMatch(/default_bind/);
    });

    test('lt dev up removes the 1.51.x default_bind from an existing Caddyfile, even with unchanged routes', () => {
      const legacy = `# lt dev — managed Caddyfile\n\n{\n\t${LEGACY}\n}\n\n${renderProjectBlock('crm', routes)}\n`;
      writeFileSync(process.env.LT_DEV_CADDYFILE as string, legacy);

      expect(upsertProjectBlock('crm', routes)).toBe(true);
      expect(readCaddyfile()).not.toMatch(/default_bind/);
      expect(readCaddyfile()).toMatch(/^# lt dev — managed Caddyfile\n\n# >>> lt-dev:crm >>>/);
      expect(upsertProjectBlock('crm', routes)).toBe(false);
    });

    test('healCaddyfile repairs a Caddyfile on paths that write no project block, once', () => {
      writeFileSync(process.env.LT_DEV_CADDYFILE as string, `# old\n\n{\n\t${LEGACY}\n}\n\n${renderProjectBlock('crm', routes)}\n`);

      expect(healCaddyfile()).toBe(true);
      expect(readCaddyfile()).not.toMatch(/default_bind/);
      expect(readCaddyfile()).toContain('reverse_proxy 127.0.0.1:4011');
      expect(healCaddyfile()).toBe(false);
    });

    test('the migration guards EVERY managed block in one step, not only the project that runs next', () => {
      // A 1.51.x Caddyfile: lt's default_bind plus blocks rendered before the per-site guard existed.
      const oldBlock = (slug: string, host: string, port: number) =>
        `# >>> lt-dev:${slug} >>>\n${host} {\n  reverse_proxy 127.0.0.1:${port} {\n    transport http {\n      max_conns_per_host 32\n    }\n  }\n}\n# <<< lt-dev:${slug} <<<`;
      const userSite = 'mine.example.test {\n  respond "user-owned"\n}';
      const legacy = [
        '# lt dev — managed Caddyfile',
        '',
        `{\n\t${LEGACY}\n}`,
        '',
        oldBlock('kit', 'kit.localhost', 4009),
        '',
        oldBlock('own-crm', 'api.own-crm.localhost', 4010).replace('# <<< lt-dev:own-crm <<<', 'own-crm.localhost {\n  reverse_proxy 127.0.0.1:4011\n}\n# <<< lt-dev:own-crm <<<'),
        '',
        userSite,
        '',
      ].join('\n');

      const migrated = migrateCaddyfile(legacy);

      expect(migrated).not.toMatch(/default_bind/);
      for (const host of ['kit.localhost', 'api.own-crm.localhost', 'own-crm.localhost']) {
        expect(migrated).toContain(`\n${host} {\n  @lt_remote not remote_ip 127.0.0.0/8 ::1\n  abort @lt_remote\n`);
      }
      expect(migrated.match(/@lt_remote not remote_ip/g)).toHaveLength(3);
      expect(migrated).toContain(userSite);
      expect(migrateCaddyfile(migrated)).toBe(migrated);
    });

    test('a freshly rendered block is not guarded twice', () => {
      const block = renderProjectBlock('crm', routes);
      expect(addLoopbackGuards(block)).toBe(block);
    });

    test('lt dev install creates the stub only when the Caddyfile is missing', () => {
      rmSync(process.env.LT_DEV_CADDYFILE as string, { force: true });
      expect(ensureCaddyfile('# stub\n')).toBe(true);
      expect(readCaddyfile()).toBe('# stub\n');
    });

    test('lt dev install keeps the projects of an existing Caddyfile and repairs the 1.51.x line', () => {
      const existing = `# lt dev\n\n{\n\t${LEGACY}\n}\n\n${renderProjectBlock('crm', routes)}\n`;
      writeFileSync(process.env.LT_DEV_CADDYFILE as string, existing);

      expect(ensureCaddyfile('# stub\n')).toBe(true);
      expect(readCaddyfile()).toContain('reverse_proxy 127.0.0.1:4011');
      expect(readCaddyfile()).not.toMatch(/default_bind/);
      expect(existsSync(process.env.LT_DEV_CADDYFILE as string)).toBe(true);
      expect(ensureCaddyfile('# stub\n')).toBe(false);
    });

    test('keeps the other global options and a default_bind the user set', () => {
      const input = `# c\n{\n\t${LEGACY}\n\temail me@example.com\n}\n\na.localhost {\n}\n`;
      expect(removeLegacyLoopbackBind(input)).toBe('# c\n{\n\temail me@example.com\n}\n\na.localhost {\n}\n');
      const own = '{\n\tdefault_bind 192.168.1.10\n}\n';
      expect(removeLegacyLoopbackBind(own)).toBe(own);
    });

    test('removing it from a project-marker file leaves the markers intact', () => {
      writeCaddyfile(`# lt dev\n\n{\n\t${LEGACY}\n}\n\n# >>> lt-dev:kit >>>\nkit.localhost {\n}\n# <<< lt-dev:kit <<<\n`);
      expect(readCaddyfile()).toBe(
        '# lt dev\n\n# >>> lt-dev:kit >>>\nkit.localhost {\n  @lt_remote not remote_ip 127.0.0.0/8 ::1\n  abort @lt_remote\n}\n# <<< lt-dev:kit <<<\n',
      );
      expect(removeProjectBlock('kit')).toBe(true);
    });
  });

  describe('removeProjectBlock', () => {
    test('removes the block + reports change', () => {
      upsertProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]);
      const removed = removeProjectBlock('crm');
      expect(removed).toBe(true);
      expect(readCaddyfile()).not.toContain('# >>> lt-dev:crm >>>');
    });
    test('no-op when block absent', () => {
      expect(removeProjectBlock('does-not-exist')).toBe(false);
    });
    test('leaves other projects intact', () => {
      upsertProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]);
      upsertProjectBlock('shop', [{ hostname: 'shop.localhost', upstreamPort: 4021 }]);
      removeProjectBlock('crm');
      const out = readCaddyfile();
      expect(out).not.toContain('# >>> lt-dev:crm >>>');
      expect(out).toContain('# >>> lt-dev:shop >>>');
    });
  });

  // `lt dev doctor` reported "all checks passed" while every reload failed on macOS (CLI 1.51.0):
  // the old Caddy kept running, held port 443 and answered on :2019, and `caddy validate` never
  // binds. Only comparing what Caddy serves with what the file says shows a failed reload.
  describe('loaded config vs Caddyfile', () => {
    // As measured on a live daemon: `GET /config/` returns the config `caddy adapt` produced with
    // its keys in another order (Caddy re-marshals what it stores). Reversed here, so the order
    // differs for sure.
    const route = (host: string, port: number) => ({
      handle: [{ handler: 'subroute', routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `127.0.0.1:${port}` }] }] }] }],
      match: [{ host: [host] }],
      terminal: true,
    });
    const adapted = (port: number) => ({
      apps: { http: { servers: { srv0: { listen: [':443'], routes: [route('crm.localhost', port), route('api.crm.localhost', 4010)] } } } },
    });
    const served = (port: number): string =>
      JSON.stringify(adapted(port), (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.keys(value).sort().reverse().map((k) => [k, value[k]]))
          : value,
      );
    const ok = (stdout: string) => async () => ({ exitCode: 0, ok: true, stderr: '', stdout });

    test('key order does not count, content does', () => {
      expect(served(4011)).not.toBe(JSON.stringify(adapted(4011)));
      expect(sameCaddyConfig(adapted(4011), JSON.parse(served(4011)))).toBe(true);
      expect(sameCaddyConfig(adapted(4011), JSON.parse(served(4999)))).toBe(false);
      expect(sameCaddyConfig({}, {})).toBe(true);
    });

    test('route order counts: Caddy runs routes in array order', () => {
      const swapped = adapted(4011);
      swapped.apps.http.servers.srv0.routes.reverse();
      expect(sameCaddyConfig(adapted(4011), swapped)).toBe(false);
    });

    test('a daemon still on its old routes reads as differs', async () => {
      const state = await compareLoadedConfig(ok(JSON.stringify(adapted(4011))), async () => served(4999));
      expect(state).toBe('differs');
    });

    test('a daemon serving the file reads as matches', async () => {
      const state = await compareLoadedConfig(ok(JSON.stringify(adapted(4011))), async () => served(4011));
      expect(state).toBe('matches');
    });

    test('unknown, never matches, when a side cannot be read', async () => {
      const failed = async () => ({ exitCode: 1, ok: false, stderr: 'adapt: bad', stdout: '' });
      expect(await compareLoadedConfig(failed, async () => '{}')).toBe('unknown');
      expect(await compareLoadedConfig(ok('{}'), async () => null)).toBe('unknown');
      expect(await compareLoadedConfig(ok('{}'), async () => 'not json')).toBe('unknown');
    });

    test('hasLegacyLoopbackBind finds only the 1.51.x line', () => {
      expect(hasLegacyLoopbackBind('{\n\tdefault_bind 127.0.0.1 [::1]\n}\n')).toBe(true);
      expect(hasLegacyLoopbackBind('{\n\tdefault_bind 192.168.1.10\n}\n')).toBe(false);
      expect(hasLegacyLoopbackBind(migrateCaddyfile('{\n\tdefault_bind 127.0.0.1 [::1]\n}\n'))).toBe(false);
    });
  });
});
