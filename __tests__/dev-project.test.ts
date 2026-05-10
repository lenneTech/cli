import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { filesystem } from 'gluegun';
import { tmpdir } from 'os';
import { join } from 'path';

import { apiNeedsPortPatch, appNeedsPortPatch, deriveDbName, resolveLayout } from '../src/lib/dev-project';

describe('dev-project', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lt-dev-project-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('resolveLayout — standalone API', () => {
    test('detects API by config.env.ts', () => {
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), '');
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'svc' }));
      const layout = resolveLayout(tmp, filesystem);
      expect(layout.apiDir).toBe(tmp);
      expect(layout.appDir).toBeNull();
      expect(layout.workspace).toBe(false);
    });
  });

  describe('resolveLayout — standalone App', () => {
    test('detects App by nuxt.config.ts', () => {
      writeFileSync(join(tmp, 'nuxt.config.ts'), '');
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'web' }));
      const layout = resolveLayout(tmp, filesystem);
      expect(layout.appDir).toBe(tmp);
      expect(layout.apiDir).toBeNull();
    });
  });

  describe('apiNeedsPortPatch', () => {
    test('flags hardcoded port', () => {
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), '    port: 3000,');
      expect(apiNeedsPortPatch(tmp)).toBe(join(tmp, 'src', 'config.env.ts'));
    });
    test('null when env-aware', () => {
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), 'port: Number(process.env.PORT) || 3000,');
      expect(apiNeedsPortPatch(tmp)).toBeNull();
    });
  });

  describe('appNeedsPortPatch', () => {
    test('flags hardcoded port + proxy target', () => {
      writeFileSync(join(tmp, 'nuxt.config.ts'), "port: 3001,\n target: 'http://localhost:3000'");
      writeFileSync(join(tmp, 'playwright.config.ts'), "baseURL: 'http://localhost:3001'");
      const out = appNeedsPortPatch(tmp);
      expect(out).toContain(join(tmp, 'nuxt.config.ts'));
      expect(out).toContain(join(tmp, 'playwright.config.ts'));
    });
  });

  describe('deriveDbName', () => {
    test('reads from config.env.ts when present', () => {
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), "    dbName: 'custom-name',");
      expect(deriveDbName(tmp, 'fallback')).toBe('custom-name');
    });
    test('falls back to <slug>-local', () => {
      expect(deriveDbName(null, 'crm')).toBe('crm-local');
    });
  });
});
