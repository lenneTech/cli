import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { filesystem, patching } from 'gluegun';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { FrontendHelper } from '../src/extensions/frontend-helper';
import { applyScaffoldIdentity } from '../src/lib/package-name';

/**
 * A new app made from a starter carries the app's identity, not the starter's. ng-base-starter
 * is flat (repo root = app), so `lt frontend angular` without a workspace used to keep its CI,
 * release tooling, changelog and package.json identity (`name` `ng-base-starter`, the starter's
 * release version, `description`, `repository`); only the workspace commands removed them.
 */

let root: string;

/** A FrontendHelper whose template step copies a seeded starter instead of cloning. */
function makeHelper(seed: string, method: 'copy' | 'link' = 'copy'): FrontendHelper {
  const quiet = { error: () => {}, info: () => {}, success: () => {}, warning: () => {} };
  const templateHelper = {
    setup: async (dest: string) => {
      cpSync(seed, dest, { recursive: true });
      return { method, path: dest, success: true };
    },
  };
  return new FrontendHelper({ filesystem, patching, print: quiet, system: {}, templateHelper } as never);
}

function readPkg(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

/** The parts of ng-base-starter 22.1.1 the setup touches or must leave alone. */
function seedNgBaseStarter(dir: string, prepare = 'simple-git-hooks'): void {
  write(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        author: 'lenne.Tech GmbH',
        description: 'Angular 22 starter (SSR, Tailwind 4, @lenne.tech/ng-base) for lenne.Tech projects.',
        devDependencies: { 'simple-git-hooks': '2.13.1' },
        license: 'MIT',
        name: 'ng-base-starter',
        private: true,
        repository: { url: 'https://github.com/lenneTech/ng-base-starter' },
        scripts: { check: 'node scripts/check.mjs', dev: 'node scripts/dev.mjs', prepare },
        version: '22.1.1',
      },
      null,
      2,
    )}\n`,
  );
  for (const file of [
    '.github/workflows/test.yml',
    '.github/workflows/release.yml',
    'CHANGELOG.md',
    'extras/notes.md',
    'migration-guides/22.0.x-to-22.1.x.md',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'scripts/check.mjs',
    'scripts/dev.mjs',
    'angular.json',
    '.husky/pre-commit',
  ]) {
    write(join(dir, file), 'x\n');
  }
}

/** The parts of nuxt-base-template the setup touches. */
function seedNuxtTemplate(dir: string): void {
  write(join(dir, 'package.json'), `${JSON.stringify({ name: 'nuxt-base-template', version: '0.0.1' }, null, 2)}\n`);
  write(join(dir, 'nuxt.config.ts'), 'export default {};\n');
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lt-scaffold-identity-')));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('applyScaffoldIdentity', () => {
  test('sets name and version and drops what describes the starter', () => {
    const pkg = applyScaffoldIdentity(
      {
        bugs: { url: 'https://github.com/lenneTech/ng-base-starter/issues' },
        dependencies: { '@angular/core': '22.2.0' },
        description: 'Angular 22 starter',
        engines: { node: '>=22' },
        homepage: 'https://github.com/lenneTech/ng-base-starter',
        license: 'MIT',
        name: 'ng-base-starter',
        repository: { url: 'https://github.com/lenneTech/ng-base-starter' },
        scripts: { check: 'node scripts/check.mjs' },
        version: '22.1.1',
      },
      { name: 'my-shop', version: '0.0.0' },
    );
    expect(pkg).toEqual({
      dependencies: { '@angular/core': '22.2.0' },
      engines: { node: '>=22' },
      license: 'MIT',
      name: 'my-shop',
      scripts: { check: 'node scripts/check.mjs' },
      version: '0.0.0',
    });
  });
});

describe('setupAngular', () => {
  test('a standalone app drops the starter repo files and carries its own identity', async () => {
    const seed = join(root, 'seed');
    seedNgBaseStarter(seed);
    const dest = join(root, 'my-shop');

    const result = await makeHelper(seed).setupAngular(dest, {
      packageName: 'my-shop',
      skipGitInit: true,
      skipInstall: true,
    });

    expect(result.success).toBe(true);
    for (const gone of ['.github', 'CHANGELOG.md', 'extras', 'migration-guides', '.husky']) {
      expect(existsSync(join(dest, gone))).toBe(false);
    }
    // A standalone app installs from its own lockfile and keeps its pnpm settings.
    for (const kept of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/check.mjs', 'scripts/dev.mjs']) {
      expect(existsSync(join(dest, kept))).toBe(true);
    }
    const pkg = readPkg(dest);
    expect(pkg.name).toBe('my-shop');
    expect(pkg.version).toBe('0.0.0');
    expect(pkg).not.toHaveProperty('description');
    expect(pkg).not.toHaveProperty('repository');
    // The app is its own git root, so its simple-git-hooks stay wired.
    expect(pkg.scripts).toEqual({
      check: 'node scripts/check.mjs',
      dev: 'node scripts/dev.mjs',
      prepare: 'simple-git-hooks',
    });
    expect(pkg.license).toBe('MIT');
  });

  test('a standalone app loses a husky prepare and the husky dependency', async () => {
    const seed = join(root, 'seed');
    seedNgBaseStarter(seed, 'husky || exit 0');
    const seedPkg = JSON.parse(readFileSync(join(seed, 'package.json'), 'utf8'));
    seedPkg.devDependencies = { husky: '9.1.7' };
    writeFileSync(join(seed, 'package.json'), `${JSON.stringify(seedPkg, null, 2)}\n`);
    const dest = join(root, 'my-shop');

    await makeHelper(seed).setupAngular(dest, { packageName: 'my-shop', skipGitInit: true, skipInstall: true });

    const pkg = readPkg(dest);
    expect(pkg.scripts).not.toHaveProperty('prepare');
    expect(pkg.devDependencies).toEqual({});
  });

  test('a workspace app is named app', async () => {
    const seed = join(root, 'seed');
    seedNgBaseStarter(seed);
    const dest = join(root, 'ws', 'projects', 'app');

    await makeHelper(seed).setupAngular(dest, { skipGitInit: true, skipInstall: true, workspace: true });

    const pkg = readPkg(dest);
    expect(pkg).toMatchObject({ name: 'app', version: '0.0.0' });
    // The workspace root owns the git hooks.
    expect(pkg.scripts).not.toHaveProperty('prepare');
    expect(existsSync(join(dest, '.github'))).toBe(false);
  });

  test('link mode leaves the linked checkout untouched', async () => {
    const seed = join(root, 'seed');
    seedNgBaseStarter(seed);
    const dest = join(root, 'linked');

    await makeHelper(seed, 'link').setupAngular(dest, { packageName: 'linked', skipGitInit: true, skipInstall: true });

    expect(readPkg(dest).name).toBe('ng-base-starter');
    expect(existsSync(join(dest, '.github', 'workflows', 'release.yml'))).toBe(true);
  });
});

describe('setupNuxt', () => {
  test('a standalone app takes its directory name, a workspace app stays app', async () => {
    const seed = join(root, 'seed');
    seedNuxtTemplate(seed);

    const standalone = join(root, 'my-shop');
    await makeHelper(seed).setupNuxt(standalone, { packageName: 'my-shop', skipInstall: true });
    expect(readPkg(standalone).name).toBe('my-shop');

    const workspaceApp = join(root, 'ws', 'projects', 'app');
    await makeHelper(seed).setupNuxt(workspaceApp, { skipInstall: true });
    expect(readPkg(workspaceApp).name).toBe('app');
  });
});
