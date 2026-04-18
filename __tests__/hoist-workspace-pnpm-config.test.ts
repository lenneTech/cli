import { hoistWorkspacePnpmConfig } from '../src/lib/hoist-workspace-pnpm-config';

const { filesystem } = require('gluegun');

describe('hoistWorkspacePnpmConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(filesystem.cwd(), '__tests__', 'temp-hoist-' + Date.now() + '-' + Math.random().toString(36).slice(2));
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
});
