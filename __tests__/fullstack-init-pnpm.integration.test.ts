import { hoistWorkspacePnpmConfig } from '../src/lib/hoist-workspace-pnpm-config';
import { buildIdentity } from '../src/lib/dev-identity';
import { setPackageName } from '../src/lib/package-name';

const { filesystem } = require('gluegun');

/**
 * Integration test for the `lt fullstack init` post-clone fixups, exercised
 * on a faithful reproduction of a freshly cloned monorepo:
 *
 *   - root           lt-monorepo package.json (name = "lt-monorepo")
 *   - projects/api   nest-server-starter — pnpm config in package.json#pnpm
 *   - projects/app   nuxt-base-template (pnpm-11) — pnpm config in
 *                    pnpm-workspace.yaml, including the allowBuilds object map
 *
 * It runs the two fixups in the same order `init.ts` does (rename root, then
 * hoist) and asserts the resulting workspace is consistent end-to-end.
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

  function scaffoldClonedMonorepo(root: string): void {
    // Root: as cloned from lt-monorepo, pnpm-10 pinned.
    writeJson(`${root}/package.json`, {
      name: 'lt-monorepo',
      packageManager: 'pnpm@10.0.0',
      private: true,
      version: '1.0.0',
    });
    filesystem.write(`${root}/pnpm-workspace.yaml`, ['packages:', "  - 'projects/*'", ''].join('\n'));

    // API: nest-server-starter ships pnpm overrides inside package.json.
    filesystem.dir(`${root}/projects/api`);
    writeJson(`${root}/projects/api/package.json`, {
      name: 'nest-base',
      pnpm: {
        onlyBuiltDependencies: ['@nestjs/core'],
        overrides: { 'fast-xml-parser@<5.7.0': '5.7.3' },
      },
    });

    // APP: nuxt-base-template (pnpm-11) keeps config in pnpm-workspace.yaml,
    // carrying the allowBuilds object map but NOT the onlyBuiltDependencies
    // array twin — the regression the normalisation guards against.
    filesystem.dir(`${root}/projects/app`);
    filesystem.write(
      `${root}/projects/app/pnpm-workspace.yaml`,
      [
        'overrides:',
        "  'vite@>=7.0.0 <7.3.2': 7.3.2",
        "  'fast-xml-parser@<5.7.0': 5.7.4",
        'ignoredOptionalDependencies:',
        "  - '@img/sharp-linux-x64'",
        'allowBuilds:',
        '  esbuild: true',
        '  sharp: true',
        '',
      ].join('\n'),
    );
  }

  it('renames the root package and hoists pnpm config from both sub-project sources', () => {
    const projectDir = `${tempDir}/crm`;
    filesystem.dir(projectDir);
    scaffoldClonedMonorepo(projectDir);

    // ── Step 1: rename root (init.ts) — slug source for `lt dev`.
    setPackageName({ filesystem, name: 'crm', packageJsonPath: `${projectDir}/package.json` });

    // ── Step 2: hoist workspace-scoped pnpm config (init.ts).
    hoistWorkspacePnpmConfig({ filesystem, projectDir, subProjects: ['projects/api', 'projects/app'] });

    const root = readJson(`${projectDir}/package.json`);

    // Root renamed → unique lt dev slug (no more lt-monorepo collision).
    expect(root.name).toBe('crm');
    expect(buildIdentity(projectDir).slug).toBe('crm');

    // overrides merged across both sources, app (sub) wins on the shared key.
    expect(root.pnpm.overrides).toEqual({
      'fast-xml-parser@<5.7.0': '5.7.4',
      'vite@>=7.0.0 <7.3.2': '7.3.2',
    });

    // onlyBuiltDependencies = api array ∪ app allowBuilds (normalised).
    expect(root.pnpm.onlyBuiltDependencies).toEqual(['@nestjs/core', 'esbuild', 'sharp']);
    expect(root.pnpm.ignoredOptionalDependencies).toEqual(['@img/sharp-linux-x64']);

    // Sub-project sources cleaned up.
    expect(readJson(`${projectDir}/projects/api/package.json`).pnpm).toBeUndefined();
    expect(filesystem.exists(`${projectDir}/projects/app/pnpm-workspace.yaml`)).toBe(false);

    // Root workspace declaration is untouched (only the nested one is removed).
    expect(filesystem.exists(`${projectDir}/pnpm-workspace.yaml`)).toBe('file');
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
    const afterFirst = filesystem.read(`${projectDir}/package.json`);
    run();
    expect(filesystem.read(`${projectDir}/package.json`)).toBe(afterFirst);
  });
});
