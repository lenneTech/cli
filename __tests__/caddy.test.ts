import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'lt-caddy-'));
process.env.LT_DEV_CADDYFILE = join(tmp, 'Caddyfile');

import { readCaddyfile, removeProjectBlock, renderProjectBlock, upsertProjectBlock, writeCaddyfile } from '../src/lib/caddy';

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
