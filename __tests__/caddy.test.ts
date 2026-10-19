import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'lt-caddy-'));
process.env.LT_DEV_CADDYFILE = join(tmp, 'Caddyfile');

import {
  ensureLoopbackBind,
  healLoopbackBind,
  readCaddyfile,
  removeProjectBlock,
  renderProjectBlock,
  upsertProjectBlock,
  writeCaddyfile,
} from '../src/lib/caddy';

describe('caddy / Caddyfile management', () => {
  beforeEach(() => {
    writeCaddyfile('# clean slate\n');
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
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

  // Without a bind every site block listens on *:443/*:80: a running stack answered anyone on the
  // LAN who sent the right Host header, the `lt dev test` stack with its seeded admin included.
  describe('loopback bind', () => {
    const BIND = 'default_bind 127.0.0.1 [::1]';

    test('every written Caddyfile starts with a global block that binds to loopback', () => {
      writeCaddyfile('# lt dev — managed Caddyfile\n');
      upsertProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }]);
      const content = readCaddyfile();
      expect(content.indexOf('{\n\tdefault_bind 127.0.0.1 [::1]\n}')).toBeGreaterThan(-1);
      expect(content.indexOf(BIND)).toBeLessThan(content.indexOf('crm.localhost {'));
      expect(content.split(BIND)).toHaveLength(2);
    });

    test('lt dev up heals a Caddyfile written before the bind existed, even with unchanged routes', () => {
      const routes = [{ hostname: 'crm.localhost', upstreamPort: 4011 }];
      writeFileSync(process.env.LT_DEV_CADDYFILE as string, `# old file\n\n${renderProjectBlock('crm', routes)}\n`);

      expect(upsertProjectBlock('crm', routes)).toBe(true);
      expect(readCaddyfile()).toContain(BIND);
      expect(upsertProjectBlock('crm', routes)).toBe(false);
    });

    test('healLoopbackBind fixes a running stack\'s Caddyfile without touching its routes, once', () => {
      const legacy = `# old file\n\n${renderProjectBlock('crm', [{ hostname: 'crm.localhost', upstreamPort: 4011 }])}\n`;
      writeFileSync(process.env.LT_DEV_CADDYFILE as string, legacy);

      expect(healLoopbackBind()).toBe(true);
      expect(readCaddyfile()).toContain(BIND);
      expect(readCaddyfile()).toContain('reverse_proxy 127.0.0.1:4011');
      expect(healLoopbackBind()).toBe(false);
    });

    test('adds the option to an existing global block and keeps its other options', () => {
      const input = '# c\n{\n\temail me@example.com\n\tlog {\n\t\tlevel ERROR\n\t}\n}\n\na.localhost {\n}\n';
      const out = ensureLoopbackBind(input);
      expect(out).toBe('# c\n{\n\tdefault_bind 127.0.0.1 [::1]\n\temail me@example.com\n\tlog {\n\t\tlevel ERROR\n\t}\n}\n\na.localhost {\n}\n');
      expect(ensureLoopbackBind(out)).toBe(out);
    });

    test('respects a default_bind the user set, whatever it binds to', () => {
      const input = '{\n\tdefault_bind 0.0.0.0\n}\n';
      expect(ensureLoopbackBind(input)).toBe(input);
    });

    test('the block goes before the first project marker, never inside a project region', () => {
      const input = '# lt dev — managed Caddyfile\n\n# >>> lt-dev:kit >>>\nkit.localhost {\n}\n# <<< lt-dev:kit <<<\n';
      expect(ensureLoopbackBind(input)).toBe(
        '# lt dev — managed Caddyfile\n\n{\n\tdefault_bind 127.0.0.1 [::1]\n}\n\n# >>> lt-dev:kit >>>\nkit.localhost {\n}\n# <<< lt-dev:kit <<<\n',
      );
      writeCaddyfile(input);
      removeProjectBlock('kit');
      expect(readCaddyfile()).toContain('default_bind 127.0.0.1 [::1]');
    });

    test('a comment-only file gets the block after its comments', () => {
      expect(ensureLoopbackBind('# a\n# b\n')).toBe('# a\n# b\n\n{\n\tdefault_bind 127.0.0.1 [::1]\n}\n');
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
});
