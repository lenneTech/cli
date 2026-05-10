// Unit tests for `local-project.ts`: workspace/standalone resolution and
// legacy-port detection helpers used by `lt local init`.
//
// `export {}` keeps the file a TS module so the top-level `require('gluegun')`
// does not collide with neighbouring test files (see other *.test.ts headers).
export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filesystem } = require('gluegun');

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { apiNeedsPortPatch, appNeedsPortPatch, resolveLayout } from '../src/lib/local-project';

const mkTempDir = (label: string): string => {
  const dir = filesystem.path('__tests__', `temp-local-project-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('resolveLayout', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { force: true, recursive: true });
  });

  test('detects monorepo workspace at the root (pnpm-workspace.yaml + projects/)', () => {
    tempDir = mkTempDir('monorepo-root');
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    mkdirSync(join(tempDir, 'projects', 'api'), { recursive: true });
    mkdirSync(join(tempDir, 'projects', 'app'), { recursive: true });
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'mono' }));

    const layout = resolveLayout(tempDir, filesystem);

    expect(layout.workspace).toBe(true);
    expect(layout.root).toBe(tempDir);
    expect(layout.apiDir).toBe(join(tempDir, 'projects', 'api'));
    expect(layout.appDir).toBe(join(tempDir, 'projects', 'app'));
  });

  test('walks up to the workspace root when called from inside projects/api', () => {
    tempDir = mkTempDir('subproject-api');
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    const apiDir = join(tempDir, 'projects', 'api');
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, 'package.json'), JSON.stringify({ name: 'api' }));

    const layout = resolveLayout(apiDir, filesystem);

    expect(layout.workspace).toBe(true);
    expect(layout.root).toBe(tempDir);
    expect(layout.apiDir).toBe(apiDir);
  });

  test('omits apiDir/appDir for halves that do not exist on disk', () => {
    tempDir = mkTempDir('monorepo-api-only');
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    mkdirSync(join(tempDir, 'projects', 'api'), { recursive: true });

    const layout = resolveLayout(tempDir, filesystem);

    expect(layout.workspace).toBe(true);
    expect(layout.apiDir).toBe(join(tempDir, 'projects', 'api'));
    expect(layout.appDir).toBeNull();
  });

  test('returns standalone API layout when only config.env.ts is present (no workspace markers)', () => {
    tempDir = mkTempDir('standalone-api');
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'config.env.ts'), 'export const x = 1;\n');
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'standalone-api' }));

    const layout = resolveLayout(tempDir, filesystem);

    expect(layout.workspace).toBe(false);
    expect(layout.apiDir).toBe(tempDir);
    expect(layout.appDir).toBeNull();
    expect(layout.name).toBe('standalone-api');
  });

  test('returns standalone App layout when only nuxt.config.ts is present', () => {
    tempDir = mkTempDir('standalone-app');
    writeFileSync(join(tempDir, 'nuxt.config.ts'), 'export default {};\n');
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'standalone-app' }));

    const layout = resolveLayout(tempDir, filesystem);

    expect(layout.workspace).toBe(false);
    expect(layout.appDir).toBe(tempDir);
    expect(layout.apiDir).toBeNull();
  });

  test('strips the npm scope from the package name', () => {
    tempDir = mkTempDir('scoped-name');
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'config.env.ts'), 'export const x = 1;\n');
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: '@lenne.tech/standalone' }));

    const layout = resolveLayout(tempDir, filesystem);
    expect(layout.name).toBe('standalone');
  });

  test('falls back to basename when package.json is missing or unparseable', () => {
    tempDir = mkTempDir('fallback-name');
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'config.env.ts'), 'export const x = 1;\n');

    const layout = resolveLayout(tempDir, filesystem);
    // basename stays whatever mkTempDir produced
    expect(layout.name).toContain('temp-local-project-fallback-name');
  });
});

describe('apiNeedsPortPatch', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { force: true, recursive: true });
  });

  test('returns null when src/config.env.ts is missing', () => {
    tempDir = mkTempDir('api-needs-missing');
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    expect(apiNeedsPortPatch(tempDir)).toBeNull();
  });

  test('returns the file path when port: 3000 is hardcoded', () => {
    tempDir = mkTempDir('api-needs-hardcoded');
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    const file = join(tempDir, 'src', 'config.env.ts');
    writeFileSync(file, '  permissions: true,\n  port: 3000,\n  sha256: true,\n');
    expect(apiNeedsPortPatch(tempDir)).toBe(file);
  });

  test('returns null when already patched (env-aware form)', () => {
    tempDir = mkTempDir('api-needs-patched');
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'config.env.ts'), '  port: Number(process.env.PORT) || 3000,\n');
    expect(apiNeedsPortPatch(tempDir)).toBeNull();
  });
});

describe('appNeedsPortPatch', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { force: true, recursive: true });
  });

  test('returns empty array when no candidate config files exist', () => {
    tempDir = mkTempDir('app-needs-empty');
    expect(appNeedsPortPatch(tempDir)).toEqual([]);
  });

  test('flags nuxt.config.ts when port: 3001 is hardcoded', () => {
    tempDir = mkTempDir('app-needs-nuxt-port');
    const file = join(tempDir, 'nuxt.config.ts');
    writeFileSync(file, '  devServer: { port: 3001, },\n');
    expect(appNeedsPortPatch(tempDir)).toEqual([file]);
  });

  test('flags nuxt.config.ts when vite proxy target is hardcoded', () => {
    tempDir = mkTempDir('app-needs-nuxt-target');
    const file = join(tempDir, 'nuxt.config.ts');
    writeFileSync(file, "  proxy: { '/api': { target: 'http://localhost:3000' } }\n");
    expect(appNeedsPortPatch(tempDir)).toEqual([file]);
  });

  test('flags playwright.config.ts when baseURL/host/url are hardcoded', () => {
    tempDir = mkTempDir('app-needs-playwright');
    const file = join(tempDir, 'playwright.config.ts');
    writeFileSync(file, "  baseURL: 'http://localhost:3001',\n");
    expect(appNeedsPortPatch(tempDir)).toEqual([file]);
  });

  test('flags both files when both have legacy patterns', () => {
    tempDir = mkTempDir('app-needs-both');
    writeFileSync(join(tempDir, 'nuxt.config.ts'), '  port: 3001,\n');
    writeFileSync(join(tempDir, 'playwright.config.ts'), "  url: 'http://localhost:3001',\n");
    const result = appNeedsPortPatch(tempDir);
    expect(result).toContain(join(tempDir, 'nuxt.config.ts'));
    expect(result).toContain(join(tempDir, 'playwright.config.ts'));
  });

  test('returns empty array when files exist but are already env-aware', () => {
    tempDir = mkTempDir('app-needs-already-patched');
    writeFileSync(join(tempDir, 'nuxt.config.ts'), '  port: Number(process.env.PORT) || 3001,\n');
    writeFileSync(
      join(tempDir, 'playwright.config.ts'),
      "  baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001',\n",
    );
    expect(appNeedsPortPatch(tempDir)).toEqual([]);
  });
});
