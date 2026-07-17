import { dump, load } from 'js-yaml';

import { hoistPackageManager, hoistWorkspacePnpmConfig } from '../src/lib/hoist-workspace-pnpm-config';

const { filesystem } = require('gluegun');

/**
 * The hoist destination is the ROOT pnpm-workspace.yaml (pnpm 11 ignores
 * package.json#pnpm). Root-owned seed settings therefore live in
 * pnpm-workspace.yaml too; sub-projects may still carry config in either
 * package.json#pnpm or their own pnpm-workspace.yaml.
 */
describe('hoistWorkspacePnpmConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-hoist-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    );
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    if (filesystem.exists(tempDir)) {
      filesystem.remove(tempDir);
    }
  });

  const writeJson = (path: string, data: unknown): void => {
    filesystem.write(path, JSON.stringify(data, null, 2) + '\n');
  };
  const readJson = (path: string): any => JSON.parse(filesystem.read(path) || '{}');

  // Root workspace helpers — the hoist source/destination for root settings.
  const seedRootWs = (data: Record<string, unknown>): void => {
    filesystem.write(`${tempDir}/pnpm-workspace.yaml`, dump({ packages: ['projects/*'], ...data }));
  };
  const rootWs = (): any => load(filesystem.read(`${tempDir}/pnpm-workspace.yaml`) || '') || {};

  it('merges `overrides` from sub-project into root with sub-project precedence', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { handlebars: '4.7.9', lodash: '4.17.0' } });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { axios: '1.15.0', lodash: '4.18.1' } },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    expect(rootWs().overrides).toEqual({
      axios: '1.15.0',
      handlebars: '4.7.9',
      lodash: '4.18.1', // sub wins
    });
    // packages: declaration preserved.
    expect(rootWs().packages).toEqual(['projects/*']);
    expect(readJson(`${tempDir}/projects/api/package.json`).pnpm).toBeUndefined();
  });

  it('dedupes and sorts `ignoredOptionalDependencies` arrays', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { ignoredOptionalDependencies: ['@img/b', '@img/a', '@img/a'] },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().ignoredOptionalDependencies).toEqual(['@img/a', '@img/b']);
  });

  it('dedupes and sorts `onlyBuiltDependencies` arrays', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ onlyBuiltDependencies: ['sharp', 'esbuild'] });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { onlyBuiltDependencies: ['bcrypt', 'esbuild', '@swc/core'] },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    expect(rootWs().onlyBuiltDependencies).toEqual(['@swc/core', 'bcrypt', 'esbuild', 'sharp']);
    // allowBuilds twin synced from the array.
    expect(rootWs().allowBuilds).toEqual({ '@swc/core': true, bcrypt: true, esbuild: true, sharp: true });
  });

  it('hoists a first-party minimumReleaseAgeExclude glob', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['minimumReleaseAgeExclude:', "  - '@lenne.tech/*'", "  - 'better-auth@1.6.13'", ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().minimumReleaseAgeExclude).toEqual(['@lenne.tech/*', 'better-auth@1.6.13']);
  });

  it('removes the entire `pnpm` section from sub-project when it becomes empty', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { overrides: { defu: '6.1.7' } },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    const app = readJson(`${tempDir}/projects/app/package.json`);
    expect(app).not.toHaveProperty('pnpm');
  });

  it('preserves non-hoisted pnpm fields in the sub-project', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: {
        overrides: { qs: '6.15.1' },
        peerDependencyRules: { allowedVersions: {} }, // not workspace-scoped here
      },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    const api = readJson(`${tempDir}/projects/api/package.json`);
    expect(api.pnpm).toEqual({ peerDependencyRules: { allowedVersions: {} } });
  });

  it('is idempotent — running twice produces the same result', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { handlebars: '4.7.9' } });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { axios: '1.15.0' } },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
    const firstRoot = filesystem.read(`${tempDir}/pnpm-workspace.yaml`);
    const firstApi = filesystem.read(`${tempDir}/projects/api/package.json`);

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
    expect(filesystem.read(`${tempDir}/pnpm-workspace.yaml`)).toEqual(firstRoot);
    expect(filesystem.read(`${tempDir}/projects/api/package.json`)).toEqual(firstApi);
  });

  it('handles missing sub-project gracefully', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { defu: '6.1.7' } });
    expect(() =>
      hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/does-not-exist'] }),
    ).not.toThrow();
    expect(rootWs().overrides).toEqual({ defu: '6.1.7' });
  });

  // ── pnpm-workspace.yaml source (nuxt-base-template pnpm-11 layout) ──────────

  it('hoists overrides from a sub-project pnpm-workspace.yaml into root', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    seedRootWs({ overrides: { 'fast-xml-parser@<5.7.0': '5.7.3' } });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      [
        'overrides:',
        "  'vite@>=7.0.0 <7.3.2': 7.3.2",
        "  'fast-xml-parser@<5.7.0': 5.7.4",
        'ignoredOptionalDependencies:',
        "  - '@img/sharp-linux-x64'",
        'onlyBuiltDependencies:',
        '  - esbuild',
        '  - sharp',
        'allowBuilds:',
        '  esbuild: true',
        '  sharp: true',
        '',
      ].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().overrides).toEqual({
      'fast-xml-parser@<5.7.0': '5.7.4', // sub wins
      'vite@>=7.0.0 <7.3.2': '7.3.2',
    });
    expect(rootWs().onlyBuiltDependencies).toEqual(['esbuild', 'sharp']);
    expect(rootWs().ignoredOptionalDependencies).toEqual(['@img/sharp-linux-x64']);
  });

  it('removes a settings-only sub-project pnpm-workspace.yaml after hoisting', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['overrides:', "  'defu@<=6.1.4': 6.1.7", 'allowBuilds:', '  sharp: true', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
    expect(rootWs().overrides).toEqual({ 'defu@<=6.1.4': '6.1.7' });
  });

  it('keeps a sub-project pnpm-workspace.yaml that declares packages, minus hoisted keys', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['packages:', "  - 'sub/*'", 'overrides:', "  'defu@<=6.1.4': 6.1.7", ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe('file');
    const remaining = load(filesystem.read(`${tempDir}/projects/app/pnpm-workspace.yaml`) || '');
    expect(remaining).toEqual({ packages: ['sub/*'] });
    expect(rootWs().overrides).toEqual({ 'defu@<=6.1.4': '6.1.7' });
  });

  it('merges both package.json#pnpm and pnpm-workspace.yaml across sub-projects', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { axios: '1.15.0' } },
    });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app' });
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['overrides:', "  'vite@>=7.0.0 <7.3.2': 7.3.2", ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    expect(rootWs().overrides).toEqual({
      axios: '1.15.0',
      'vite@>=7.0.0 <7.3.2': '7.3.2',
    });
    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
  });

  it('is idempotent for the pnpm-workspace.yaml source', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['overrides:', "  'defu@<=6.1.4': 6.1.7", ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });
    const firstRoot = filesystem.read(`${tempDir}/pnpm-workspace.yaml`);

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });
    expect(filesystem.read(`${tempDir}/pnpm-workspace.yaml`)).toEqual(firstRoot);
    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
  });

  it('leaves a malformed sub-project pnpm-workspace.yaml untouched', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    const broken = 'overrides:\n  - [unbalanced';
    filesystem.write(`${tempDir}/projects/app/pnpm-workspace.yaml`, broken);

    expect(() =>
      hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] }),
    ).not.toThrow();
    expect(filesystem.read(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(broken);
  });

  it('skips a symlinked sub-project without mutating its source tree', () => {
    const realFs = require('fs');
    // Real sub-project tree lives outside the workspace; projects/app is a symlink to it.
    const realApp = `${tempDir}/external-app`;
    filesystem.dir(realApp);
    filesystem.write(`${realApp}/pnpm-workspace.yaml`, ['overrides:', "  'defu@<=6.1.4': 6.1.7", ''].join('\n'));
    filesystem.dir(`${tempDir}/projects`);
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    realFs.symlinkSync(realApp, `${tempDir}/projects/app`);

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    // Symlinked source must remain intact and nothing hoisted.
    expect(filesystem.exists(`${realApp}/pnpm-workspace.yaml`)).toBe('file');
    expect(filesystem.exists(`${tempDir}/pnpm-workspace.yaml`)).toBe(false);
  });

  // ── allowBuilds ↔ onlyBuiltDependencies sync ───────────────────────────────

  it('derives onlyBuiltDependencies from a pnpm-11 allowBuilds map (no array twin)', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['allowBuilds:', '  esbuild: true', '  sharp: true', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().onlyBuiltDependencies).toEqual(['esbuild', 'sharp']);
    expect(rootWs().allowBuilds).toEqual({ esbuild: true, sharp: true });
    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
  });

  it('only allows allowBuilds packages whose value is true', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['allowBuilds:', '  esbuild: true', '  puppeteer: false', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().onlyBuiltDependencies).toEqual(['esbuild']);
    // explicit false preserved in the map.
    expect(rootWs().allowBuilds).toEqual({ esbuild: true, puppeteer: false });
  });

  it('unions allowBuilds with an existing onlyBuiltDependencies array', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['onlyBuiltDependencies:', '  - esbuild', 'allowBuilds:', '  esbuild: true', '  sharp: true', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(rootWs().onlyBuiltDependencies).toEqual(['esbuild', 'sharp']);
    expect(rootWs().allowBuilds).toEqual({ esbuild: true, sharp: true });
  });
});

/**
 * `packageManager` is a TOP-LEVEL package.json field read by Corepack, so unlike the
 * pnpm block above its hoist destination is the root package.json. Only the root pin
 * governs the install; one left behind in projects/app makes
 * `cd projects/app && pnpm run build` provision a different pnpm than the root used.
 */
describe('hoistPackageManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-hoist-pm-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    );
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    if (filesystem.exists(tempDir)) {
      filesystem.remove(tempDir);
    }
  });

  const writeJson = (path: string, data: unknown): void => {
    filesystem.write(path, JSON.stringify(data, null, 2) + '\n');
  };
  const readJson = (path: string): any => JSON.parse(filesystem.read(path) || '{}');

  const PIN_11_13_1 = 'pnpm@11.13.1+sha512.b2fc7683b8a6525414e7d13e1ba28caaddde96bf66ec540bfaeb7e702b81f3e0';

  it('hoists a sub-project pin to a root that has none and strips the sub-project', () => {
    writeJson(`${tempDir}/package.json`, { engines: { pnpm: '^11.0.0' }, name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: PIN_11_13_1 });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBe(PIN_11_13_1);
    expect(readJson(`${tempDir}/projects/app/package.json`).packageManager).toBeUndefined();
    // Unrelated root fields survive.
    expect(readJson(`${tempDir}/package.json`).engines).toEqual({ pnpm: '^11.0.0' });
  });

  it('keeps the highest version across sub-projects and root, incl. integrity hash', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root', packageManager: 'pnpm@11.2.0' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', packageManager: 'pnpm@11.9.0' });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: PIN_11_13_1 });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBe(PIN_11_13_1);
    expect(readJson(`${tempDir}/projects/api/package.json`).packageManager).toBeUndefined();
    expect(readJson(`${tempDir}/projects/app/package.json`).packageManager).toBeUndefined();
  });

  it('does not downgrade a newer root pin, but still strips the sub-projects', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root', packageManager: 'pnpm@11.20.0' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: 'pnpm@11.4.0' });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBe('pnpm@11.20.0');
    expect(readJson(`${tempDir}/projects/app/package.json`).packageManager).toBeUndefined();
  });

  it('compares versions numerically, not lexically (11.9.0 < 11.13.1)', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', packageManager: 'pnpm@11.9.0' });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: 'pnpm@11.13.1' });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBe('pnpm@11.13.1');
  });

  it('leaves everything untouched when the managers differ', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/api/package.json`, { name: 'api', packageManager: 'yarn@4.6.0' });
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: PIN_11_13_1 });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/api', 'projects/app'] });

    expect(readJson(`${tempDir}/package.json`).packageManager).toBeUndefined();
    expect(readJson(`${tempDir}/projects/api/package.json`).packageManager).toBe('yarn@4.6.0');
    expect(readJson(`${tempDir}/projects/app/package.json`).packageManager).toBe(PIN_11_13_1);
  });

  it('is a no-op when no sub-project carries a pin', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app' });
    const rootBefore = filesystem.read(`${tempDir}/package.json`);

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(filesystem.read(`${tempDir}/package.json`)).toBe(rootBefore);
  });

  it('is idempotent', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, { name: 'app', packageManager: PIN_11_13_1 });

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });
    const rootAfterFirst = filesystem.read(`${tempDir}/package.json`);
    const appAfterFirst = filesystem.read(`${tempDir}/projects/app/package.json`);

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(filesystem.read(`${tempDir}/package.json`)).toBe(rootAfterFirst);
    expect(filesystem.read(`${tempDir}/projects/app/package.json`)).toBe(appAfterFirst);
  });

  it('skips a symlinked sub-project without mutating its source tree', () => {
    const realFs = require('fs');
    const realApp = `${tempDir}/external-app`;
    filesystem.dir(realApp);
    writeJson(`${realApp}/package.json`, { name: 'app', packageManager: PIN_11_13_1 });
    filesystem.dir(`${tempDir}/projects`);
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    realFs.symlinkSync(realApp, `${tempDir}/projects/app`);

    hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    // The user's own checkout keeps its pin; nothing hoisted.
    expect(readJson(`${realApp}/package.json`).packageManager).toBe(PIN_11_13_1);
    expect(readJson(`${tempDir}/package.json`).packageManager).toBeUndefined();
  });

  it('tolerates a missing sub-project dir', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });

    expect(() =>
      hoistPackageManager({ filesystem, projectDir: tempDir, subProjects: ['projects/does-not-exist'] }),
    ).not.toThrow();
  });
});
