import { hoistWorkspacePnpmConfig } from '../src/lib/hoist-workspace-pnpm-config';

const { filesystem } = require('gluegun');

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

  it('merges `overrides` from sub-project into root with sub-project precedence', () => {
    writeJson(`${tempDir}/package.json`, {
      name: 'root',
      pnpm: { overrides: { handlebars: '4.7.9', lodash: '4.17.0' } },
    });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { axios: '1.15.0', lodash: '4.18.1' } },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.overrides).toEqual({
      axios: '1.15.0',
      handlebars: '4.7.9',
      lodash: '4.18.1', // sub wins
    });
    const api = readJson(`${tempDir}/projects/api/package.json`);
    expect(api.pnpm).toBeUndefined();
  });

  it('dedupes and sorts `ignoredOptionalDependencies` arrays', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    writeJson(`${tempDir}/projects/app/package.json`, {
      name: 'app',
      pnpm: { ignoredOptionalDependencies: ['@img/b', '@img/a', '@img/a'] },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.ignoredOptionalDependencies).toEqual(['@img/a', '@img/b']);
  });

  it('dedupes and sorts `onlyBuiltDependencies` arrays', () => {
    writeJson(`${tempDir}/package.json`, {
      name: 'root',
      pnpm: { onlyBuiltDependencies: ['sharp', 'esbuild'] },
    });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { onlyBuiltDependencies: ['bcrypt', 'esbuild', '@swc/core'] },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.onlyBuiltDependencies).toEqual(['@swc/core', 'bcrypt', 'esbuild', 'sharp']);
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

  it('preserves other pnpm fields in the sub-project', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: {
        overrides: { qs: '6.15.1' },
        peerDependencyRules: { allowedVersions: {} }, // non-workspace-scoped
      },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });

    const api = readJson(`${tempDir}/projects/api/package.json`);
    expect(api.pnpm).toEqual({ peerDependencyRules: { allowedVersions: {} } });
  });

  it('is idempotent — running twice produces the same result', () => {
    writeJson(`${tempDir}/package.json`, {
      name: 'root',
      pnpm: { overrides: { handlebars: '4.7.9' } },
    });
    filesystem.dir(`${tempDir}/projects/api`);
    writeJson(`${tempDir}/projects/api/package.json`, {
      name: 'api',
      pnpm: { overrides: { axios: '1.15.0' } },
    });

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
    const firstRoot = filesystem.read(`${tempDir}/package.json`);
    const firstApi = filesystem.read(`${tempDir}/projects/api/package.json`);

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/api'] });
    expect(filesystem.read(`${tempDir}/package.json`)).toEqual(firstRoot);
    expect(filesystem.read(`${tempDir}/projects/api/package.json`)).toEqual(firstApi);
  });

  it('handles missing sub-project gracefully', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root', pnpm: { overrides: { defu: '6.1.7' } } });
    expect(() =>
      hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/does-not-exist'] }),
    ).not.toThrow();
    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.overrides).toEqual({ defu: '6.1.7' });
  });

  // ── pnpm-workspace.yaml source (nuxt-base-template pnpm-11 layout) ──────────

  it('hoists overrides from a sub-project pnpm-workspace.yaml into root package.json', () => {
    writeJson(`${tempDir}/package.json`, {
      name: 'root',
      pnpm: { overrides: { 'fast-xml-parser@<5.7.0': '5.7.3' } },
    });
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

    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.overrides).toEqual({
      'fast-xml-parser@<5.7.0': '5.7.4', // sub wins
      'vite@>=7.0.0 <7.3.2': '7.3.2',
    });
    expect(root.pnpm.onlyBuiltDependencies).toEqual(['esbuild', 'sharp']);
    expect(root.pnpm.ignoredOptionalDependencies).toEqual(['@img/sharp-linux-x64']);
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
    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.overrides).toEqual({ 'defu@<=6.1.4': '6.1.7' });
  });

  it('keeps a sub-project pnpm-workspace.yaml that declares packages, minus hoisted keys', () => {
    const yaml = require('js-yaml');
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['packages:', "  - 'sub/*'", 'overrides:', "  'defu@<=6.1.4': 6.1.7", ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe('file');
    const remaining = yaml.load(filesystem.read(`${tempDir}/projects/app/pnpm-workspace.yaml`));
    expect(remaining).toEqual({ packages: ['sub/*'] });
    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.overrides).toEqual({ 'defu@<=6.1.4': '6.1.7' });
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

    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.overrides).toEqual({
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
    const firstRoot = filesystem.read(`${tempDir}/package.json`);

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });
    expect(filesystem.read(`${tempDir}/package.json`)).toEqual(firstRoot);
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
    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm?.overrides).toBeUndefined();
  });

  // ── pnpm-11 allowBuilds normalisation ──────────────────────────────────────

  it('hoists a pnpm-11 allowBuilds map even without the onlyBuiltDependencies twin', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['allowBuilds:', '  esbuild: true', '  sharp: true', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.onlyBuiltDependencies).toEqual(['esbuild', 'sharp']);
    // settings-only file is removed after hoisting
    expect(filesystem.exists(`${tempDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
  });

  it('only hoists allowBuilds packages whose value is true', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['allowBuilds:', '  esbuild: true', '  puppeteer: false', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.onlyBuiltDependencies).toEqual(['esbuild']);
  });

  it('unions allowBuilds into an existing onlyBuiltDependencies array', () => {
    writeJson(`${tempDir}/package.json`, { name: 'root' });
    filesystem.dir(`${tempDir}/projects/app`);
    filesystem.write(
      `${tempDir}/projects/app/pnpm-workspace.yaml`,
      ['onlyBuiltDependencies:', '  - esbuild', 'allowBuilds:', '  esbuild: true', '  sharp: true', ''].join('\n'),
    );

    hoistWorkspacePnpmConfig({ filesystem, projectDir: tempDir, subProjects: ['projects/app'] });

    const root = readJson(`${tempDir}/package.json`);
    expect(root.pnpm.onlyBuiltDependencies).toEqual(['esbuild', 'sharp']);
  });
});
