import { load } from 'js-yaml';

import { hoistPackageManager, hoistWorkspacePnpmConfig } from '../src/lib/hoist-workspace-pnpm-config';
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

  /** The exact pin nuxt-base-template ships, as written by `corepack up`. */
  const APP_PIN = 'pnpm@11.13.1+sha512.b2fc7683b8a6525414e7d13e1ba28caaddde96bf66ec540bfaeb7e702b81f3e0';

  function scaffoldClonedMonorepo(root: string): void {
    // Root: as cloned from lt-monorepo (pnpm 11). Workspace-scoped settings
    // live in pnpm-workspace.yaml; it seeds one of its own overrides.
    // NOTE: lt-monorepo ships NO `packageManager` — it only declares
    // `engines.pnpm: "^11.0.0"`. The exact pin arrives via hoistPackageManager
    // from the starters. Without it Corepack would download the latest pnpm and
    // break against that engines range once pnpm 12 ships.
    writeJson(`${root}/package.json`, {
      engines: { node: '>= 22', pnpm: '^11.0.0' },
      name: 'lt-monorepo',
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
    // twin) and a first-party minimumReleaseAgeExclude glob. Its package.json
    // carries the exact Corepack pin (incl. integrity hash, maintained via
    // `corepack up`) that must end up at the workspace root.
    filesystem.dir(`${root}/projects/app`);
    writeJson(`${root}/projects/app/package.json`, {
      name: 'nuxt-base-template',
      packageManager: APP_PIN,
    });
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

  it('hoists the app pin to the root so one pnpm governs the whole build', () => {
    const projectDir = `${tempDir}/shop`;
    filesystem.dir(projectDir);
    scaffoldClonedMonorepo(projectDir);

    hoistWorkspacePnpmConfig({ filesystem, projectDir, subProjects: ['projects/api', 'projects/app'] });
    hoistPackageManager({ filesystem, projectDir, subProjects: ['projects/api', 'projects/app'] });

    // The root now pins the exact version incl. integrity hash: `pnpm install`
    // at the root is deterministic and survives the pnpm 12 release.
    expect(readJson(`${projectDir}/package.json`).packageManager).toBe(APP_PIN);
    // engines guard untouched — pin (provisioning) and range (guard) coexist.
    expect(readJson(`${projectDir}/package.json`).engines).toEqual({ node: '>= 22', pnpm: '^11.0.0' });

    // Sub-project pin gone: otherwise `cd projects/app && pnpm run build` (what
    // projects/app/Dockerfile does) would resolve the NEAREST package.json and
    // provision a second pnpm inside the same build.
    expect(readJson(`${projectDir}/projects/app/package.json`).packageManager).toBeUndefined();
    // Renaming the root must not have been clobbered by the pin write.
    expect(readJson(`${projectDir}/projects/app/package.json`).name).toBe('nuxt-base-template');
  });

  it('is idempotent across the whole init fixup sequence', () => {
    const projectDir = `${tempDir}/shop`;
    filesystem.dir(projectDir);
    scaffoldClonedMonorepo(projectDir);

    const run = (): void => {
      setPackageName({ filesystem, name: 'shop', packageJsonPath: `${projectDir}/package.json` });
      hoistWorkspacePnpmConfig({ filesystem, projectDir, subProjects: ['projects/api', 'projects/app'] });
      hoistPackageManager({ filesystem, projectDir, subProjects: ['projects/api', 'projects/app'] });
    };

    run();
    const afterFirst = filesystem.read(`${projectDir}/pnpm-workspace.yaml`);
    const rootPkgAfterFirst = filesystem.read(`${projectDir}/package.json`);
    run();
    expect(filesystem.read(`${projectDir}/pnpm-workspace.yaml`)).toBe(afterFirst);
    expect(filesystem.read(`${projectDir}/package.json`)).toBe(rootPkgAfterFirst);
  });
});
