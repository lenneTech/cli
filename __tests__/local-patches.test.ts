import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { autoPatch, patchApiConfig, patchClaudeMd, patchNuxtConfig, patchPlaywrightConfig } from '../src/lib/local-patches';

describe('local-patches', () => {
  const TEMP = join(tmpdir(), `lt-local-patches-test-${process.pid}`);

  beforeEach(() => {
    mkdirSync(TEMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEMP)) rmSync(TEMP, { force: true, recursive: true });
  });

  describe('patchApiConfig', () => {
    it('replaces hardcoded `port: 3000,` with env-aware form', () => {
      const file = join(TEMP, 'config.env.ts');
      writeFileSync(file, [
        '  permissions: true,',
        '  port: 3000,',
        '  sha256: true,',
      ].join('\n'));
      const result = patchApiConfig(file);
      expect(result.patched).toBe(true);
      expect(result.replacements).toBe(1);
      const after = readFileSync(file, 'utf8');
      expect(after).toContain('port: Number(process.env.PORT) || 3000,');
      expect(after).not.toMatch(/^\s*port:\s*3000,/m);
    });

    it('is idempotent: re-running on already-patched file does nothing', () => {
      const file = join(TEMP, 'config.env.ts');
      writeFileSync(file, '  port: Number(process.env.PORT) || 3000,\n');
      const result = patchApiConfig(file);
      expect(result.patched).toBe(false);
      expect(result.replacements).toBe(0);
    });

    it('handles multiple occurrences in one file (deployedConfig + localConfig)', () => {
      const file = join(TEMP, 'config.env.ts');
      writeFileSync(file, [
        '  port: 3000,',
        '  // separator',
        '  port: 3000,',
      ].join('\n'));
      const result = patchApiConfig(file);
      expect(result.patched).toBe(true);
      expect(result.replacements).toBe(2);
    });
  });

  describe('patchNuxtConfig', () => {
    it('rewrites devServer.port and Vite proxy targets', () => {
      const file = join(TEMP, 'nuxt.config.ts');
      writeFileSync(file, [
        '  devServer: {',
        '    port: 3001,',
        '  },',
        '  proxy: {',
        "    '/api': { target: 'http://localhost:3000' },",
        "    '/iam': { target: 'http://localhost:3000' },",
        '  },',
      ].join('\n'));
      const result = patchNuxtConfig(file);
      expect(result.patched).toBe(true);
      expect(result.replacements).toBe(3);
      const after = readFileSync(file, 'utf8');
      expect(after).toContain('port: Number(process.env.PORT) || 3001,');
      expect(after).toContain("target: process.env.NUXT_API_URL || 'http://localhost:3000'");
    });

    it('is idempotent', () => {
      const file = join(TEMP, 'nuxt.config.ts');
      writeFileSync(file, [
        '  port: Number(process.env.PORT) || 3001,',
        "  target: process.env.NUXT_API_URL || 'http://localhost:3000',",
      ].join('\n'));
      const result = patchNuxtConfig(file);
      expect(result.patched).toBe(false);
    });
  });

  describe('patchPlaywrightConfig', () => {
    it('rewrites baseURL, host, and url to NUXT_PUBLIC_SITE_URL', () => {
      const file = join(TEMP, 'playwright.config.ts');
      writeFileSync(file, [
        "    baseURL: 'http://localhost:3001',",
        "    host: 'http://localhost:3001',",
        "      url: 'http://localhost:3001',",
      ].join('\n'));
      const result = patchPlaywrightConfig(file);
      expect(result.patched).toBe(true);
      expect(result.replacements).toBe(3);
      const after = readFileSync(file, 'utf8');
      expect(after).toContain("baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'");
      expect(after).toContain("host: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'");
      expect(after).toContain("url: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'");
    });

    it('is idempotent', () => {
      const file = join(TEMP, 'playwright.config.ts');
      writeFileSync(file, "  baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001',\n");
      const result = patchPlaywrightConfig(file);
      expect(result.patched).toBe(false);
    });
  });

  describe('autoPatch dispatch', () => {
    it('dispatches based on filename', () => {
      const api = join(TEMP, 'config.env.ts');
      const nuxt = join(TEMP, 'nuxt.config.ts');
      const pw = join(TEMP, 'playwright.config.ts');
      writeFileSync(api, '  port: 3000,\n');
      writeFileSync(nuxt, '  port: 3001,\n');
      writeFileSync(pw, "  baseURL: 'http://localhost:3001',\n");

      expect(autoPatch(api).patched).toBe(true);
      expect(autoPatch(nuxt).patched).toBe(true);
      expect(autoPatch(pw).patched).toBe(true);
    });

    it('returns no-op for unrelated files', () => {
      const file = join(TEMP, 'random.ts');
      writeFileSync(file, '  port: 3000,\n');
      const result = autoPatch(file);
      expect(result.patched).toBe(false);
    });
  });

  describe('missing-file handling (consistent across all patch functions)', () => {
    it('patchApiConfig: missing file → no-op (does NOT throw)', () => {
      const file = join(TEMP, 'does-not-exist-config.env.ts');
      const result = patchApiConfig(file);
      expect(result.patched).toBe(false);
      expect(result.replacements).toBe(0);
    });

    it('patchNuxtConfig: missing file → no-op', () => {
      const file = join(TEMP, 'does-not-exist-nuxt.config.ts');
      const result = patchNuxtConfig(file);
      expect(result.patched).toBe(false);
      expect(result.replacements).toBe(0);
    });

    it('patchPlaywrightConfig: missing file → no-op', () => {
      const file = join(TEMP, 'does-not-exist-playwright.config.ts');
      const result = patchPlaywrightConfig(file);
      expect(result.patched).toBe(false);
      expect(result.replacements).toBe(0);
    });

    it('autoPatch: dispatches to a no-op for any missing file with a known extension', () => {
      expect(autoPatch(join(TEMP, 'missing-config.env.ts')).patched).toBe(false);
      expect(autoPatch(join(TEMP, 'missing-nuxt.config.ts')).patched).toBe(false);
      expect(autoPatch(join(TEMP, 'missing-playwright.config.ts')).patched).toBe(false);
    });
  });

  describe('patchClaudeMd', () => {
    it('appends a port block to an existing CLAUDE.md', () => {
      const file = join(TEMP, 'CLAUDE.md');
      writeFileSync(file, '# Project X\n\nSome existing content.\n');
      const result = patchClaudeMd(file, { apiPort: 3030, appPort: 3031, dbName: 'crm-local', slug: 'crm' });
      expect(result.patched).toBe(true);
      const after = readFileSync(file, 'utf8');
      expect(after).toContain('# Project X');
      expect(after).toContain('lt-local:port-block:start');
      expect(after).toContain('lt-local:port-block:end');
      expect(after).toContain('http://localhost:3030');
      expect(after).toContain('http://localhost:3031');
      expect(after).toContain('mongodb://127.0.0.1/crm-local');
      expect(after).toContain('crm');
    });

    it('replaces an existing port block in place when ports change', () => {
      const file = join(TEMP, 'CLAUDE.md');
      writeFileSync(file, '# Project X\n\nIntro.\n');
      patchClaudeMd(file, { apiPort: 3030, appPort: 3031, dbName: 'x-local', slug: 'x' });
      const beforeReplace = readFileSync(file, 'utf8');
      expect(beforeReplace).toContain('http://localhost:3030');

      patchClaudeMd(file, { apiPort: 3060, appPort: 3061, dbName: 'x-local', slug: 'x' });
      const afterReplace = readFileSync(file, 'utf8');
      expect(afterReplace).toContain('http://localhost:3060');
      expect(afterReplace).not.toContain('http://localhost:3030');
      // Only one block remains
      expect(afterReplace.match(/lt-local:port-block:start/g)?.length).toBe(1);
    });

    it('is idempotent: same ports → no-op', () => {
      const file = join(TEMP, 'CLAUDE.md');
      writeFileSync(file, '# Project X\n');
      const r1 = patchClaudeMd(file, { apiPort: 3030, appPort: 3031, slug: 'x' });
      const r2 = patchClaudeMd(file, { apiPort: 3030, appPort: 3031, slug: 'x' });
      expect(r1.patched).toBe(true);
      expect(r2.patched).toBe(false);
    });

    it('does not create CLAUDE.md from scratch', () => {
      const file = join(TEMP, 'NOT-EXISTING.md');
      const result = patchClaudeMd(file, { apiPort: 3030, appPort: 3031, slug: 'x' });
      expect(result.patched).toBe(false);
      expect(existsSync(file)).toBe(false);
    });

    it('omits the DB line when dbName is not provided', () => {
      const file = join(TEMP, 'CLAUDE.md');
      writeFileSync(file, '# Project X\n');
      patchClaudeMd(file, { apiPort: 3030, appPort: 3031, slug: 'x' });
      const after = readFileSync(file, 'utf8');
      expect(after).not.toContain('mongodb://');
    });
  });
});
