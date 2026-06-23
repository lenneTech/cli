import { load } from 'js-yaml';

import { hoistWorkspacePnpmConfig } from '../src/lib/hoist-workspace-pnpm-config';
import { buildIdentity } from '../src/lib/dev-identity';
import { setPackageName } from '../src/lib/package-name';

const { filesystem } = require('gluegun');

/**
 * Integration test for the `lt fullstack init` post-clone fixups, exercised
 * on a faithful reproduction of a freshly cloned monorepo:
 *
 *   - root           lt-monorepo (pnpm 11): pnpm settings in pnpm-workspace.yaml
 *   - projects/api   nest-server-starter — pnpm config in package.json#pnpm
 *   - projects/app   nuxt-base-template (pnpm-11) — pnpm config in
 *                    pnpm-workspace.yaml, including the allowBuilds object map
 *                    and a first-party minimumReleaseAgeExclude glob
 *
 * It runs the two fixups in the same order `init.ts` does (rename root, then
 * hoist) and asserts the resulting workspace is consistent end-to-end:
 * everything lands in the ROOT pnpm-workspace.yaml (pnpm 11 ignores
 * package.json#pnpm), and the build-allowlist twins stay in sync.
 */
describe('fullstack init pnpm/identity fixups (integration)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-init-' + Date.now() + '-' + Math.random().toString(36).slice(2),
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
  const readYaml = (path: string): any => load(filesystem.read(path) || '') || {};

  function scaffoldClonedMonorepo(root: string): void {
    // Root: as cloned from lt-monorepo (pnpm 11). Workspace-scoped settings
    // live in pnpm-workspace.yaml; it seeds one of its own overrides.
    writeJson(`${root}/package.json`, {
      name: 'lt-monorepo',
      packageManager: 'pnpm@11.5.1',
      private: true,
      version: '1.0.0',
    });
    filesystem.write(
      `${root}/pnpm-workspace.yaml`,
      ['packages:', "  - 'projects/*'", 'overrides:', "  'fast-xml-parser@<5.7.0': 5.7.3", ''].join('\n'),
    );

    // API: nest-server-starter ships pnpm overrides inside package.json.
    filesystem.dir(`${root}/projects/api`);
    writeJson(`${root}/projects/api/package.json`, {
      name: 'nest-base',
      pnpm: {
        onlyBuiltDependencies: ['@nestjs/core'],
        overrides: { 'fast-xml-parser@<5.7.0': '5.7.4' },
      },
    });

    // APP: nuxt-base-template (pnpm-11) keeps config in pnpm-workspace.yaml,
    // carrying the allowBuilds object map (NOT the onlyBuiltDependencies array
    // twin) and a first-party minimumReleaseAgeExclude glob.
    filesystem.dir(`${root}/projects/app`);
    filesystem.write(
      `${root}/projects/app/pnpm-workspace.yaml`,
      [
        'overrides:',
        "  'vite@>=7.0.0 <7.3.2': 7.3.2",
        "  'fast-xml-parser@<5.7.0': 5.7.5",
        'ignoredOptionalDependencies:',
        "  - '@img/sharp-linux-x64'",
        'allowBuilds:',
        '  esbuild: true',
        '  sharp: true',
        'minimumReleaseAgeExclude:',
        "  - '@lenne.tech/*'",
        '',
      ].join('\n'),
    );
  }

  it('renames root and hoists pnpm config from both sources into root pnpm-workspace.yaml', () => {
    const projectDir = `${tempDir}/crm`;
    filesystem.dir(projectDir);
    scaffoldClonedMonorepo(projectDir);

    // ── Step 1: rename root (init.ts) — slug source for `lt dev`.
    setPackageName({ filesystem, name: 'crm', packageJsonPath: `${projectDir}/package.json` });

    // ── Step 2: hoist workspace-scoped pnpm config (init.ts).
    hoistWorkspacePnpmConfig({ filesystem, projectDir, subProjects: ['projects/api', 'projects/app'] });

    const ws = readYaml(`${projectDir}/pnpm-workspace.yaml`);

    // Root renamed → unique lt dev slug (no more lt-monorepo collision).
    expect(readJson(`${projectDir}/package.json`).name).toBe('crm');
    expect(buildIdentity(projectDir).slug).toBe('crm');

    // packages: declaration preserved.
    expect(ws.packages).toEqual(['projects/*']);

    // overrides merged across root seed + both sub sources; the later sub
    // (app) wins on the shared fast-xml-parser key.
    expect(ws.overrides).toEqual({
      'fast-xml-parser@<5.7.0': '5.7.5',
      'vite@>=7.0.0 <7.3.2': '7.3.2',
    });

    // Build-allowlist twins synced: api array ∪ app allowBuilds.
    expect(ws.onlyBuiltDependencies).toEqual(['@nestjs/core', 'esbuild', 'sharp']);
    expect(ws.allowBuilds).toEqual({ '@nestjs/core': true, esbuild: true, sharp: true });

    expect(ws.ignoredOptionalDependencies).toEqual(['@img/sharp-linux-x64']);

    // First-party minimum-release-age exemption hoisted (would otherwise be
    // dropped, blocking freshly published @lenne.tech packages in the monorepo).
    expect(ws.minimumReleaseAgeExclude).toEqual(['@lenne.tech/*']);

    // Settings did NOT leak into package.json#pnpm (pnpm 11 would ignore them).
    expect(readJson(`${projectDir}/package.json`).pnpm).toBeUndefined();

    // Sub-project sources cleaned up.
    expect(readJson(`${projectDir}/projects/api/package.json`).pnpm).toBeUndefined();
    expect(filesystem.exists(`${projectDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);
  });

  it('is idempotent across the whole init fixup sequence', () => {
    const projectDir = `${tempDir}/shop`;
    filesystem.dir(projectDir);
    scaffoldClonedMonorepo(projectDir);

    const run = (): void => {
      setPackageName({ filesystem, name: 'shop', packageJsonPath: `${projectDir}/package.json` });
      hoistWorkspacePnpmConfig({ filesystem, projectDir, subProjects: ['projects/api', 'projects/app'] });
    };

    run();
    const afterFirst = filesystem.read(`${projectDir}/pnpm-workspace.yaml`);
    run();
    expect(filesystem.read(`${projectDir}/pnpm-workspace.yaml`)).toBe(afterFirst);
  });
});
