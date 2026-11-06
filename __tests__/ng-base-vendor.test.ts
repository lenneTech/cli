import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { filesystem } from 'gluegun';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { FrontendHelper } from '../src/extensions/frontend-helper';
import { isVendoredProject } from '../src/lib/framework-detection';
import { detectFrontendFramework } from '../src/lib/frontend-kind';
import {
  applyVendorDependencies,
  buildNgBaseVendorMd,
  copyNgBaseSource,
  isVendoredNgBaseProject,
  ngBaseEntryPoints,
  ngBaseTag,
  ngBaseTsconfigPaths,
  applyLocalNgBaseDependency,
  pinnedNgBaseVersion,
  resolveLocalNgBaseBuild,
  resolveNgBaseLibraryDir,
  rewriteNgBaseStyleImports,
  setNgBaseTsconfigPaths,
} from '../src/lib/ng-base-vendor';

/**
 * Vendor mode for Angular apps (`@lenne.tech/ng-base` → `src/core/`).
 *
 * The fixture follows the layout contract with ng-base (plan.md §5.6): the library
 * in `projects/ng-base/`, primary entry `index.ts`, each secondary entry point a
 * direct subfolder with `ng-package.json` + `index.ts`.
 */

let root: string;

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * A local ng-base checkout as `--frontend-framework-copy` points at it, in the
 * `ng g library` layout: `ng-package.json` per entry point, source in `src/`,
 * `lib.entryFile` defaulting to `src/public-api.ts`.
 */
function seedNgBaseRepo(dir: string): void {
  const lib = join(dir, 'projects', 'ng-base');
  write(join(dir, 'LICENSE'), 'MIT\n');
  write(
    join(lib, 'ng-package.json'),
    '{ "dest": "../../dist/ng-base", "lib": { "entryFile": "src/public-api.ts" } }\n',
  );
  write(
    join(lib, 'package.json'),
    JSON.stringify({
      dependencies: { tslib: '^2.8.0' },
      name: '@lenne.tech/ng-base',
      peerDependencies: {
        '@angular/core': '^22.2.0',
        '@playwright/test': '>=1.50.0',
        'better-auth': '>=1.7.16 <1.8.0',
        'tus-js-client': '>=4',
      },
      version: '22.0.0',
    }),
  );
  write(join(lib, 'tsconfig.lib.json'), '{}\n');
  write(join(lib, 'README.md'), '# ng-base\n');
  write(join(lib, 'CLAUDE.md'), '# Working on ng-base\n');
  write(join(lib, 'ui', 'styles', 'theme.css'), "@import './palette.css';\n");
  write(join(lib, 'src', 'public-api.ts'), "export * from './lib/config';\n");
  write(join(lib, 'src', 'lib', 'config.ts'), 'export const LT = 1;\n');
  write(join(lib, 'src', 'lib', 'config.spec.ts'), "it('x', () => {});\n");
  write(join(lib, 'src', 'test-setup.ts'), "import 'vitest';\n");
  // A secondary entry point as `ng g library` writes it ...
  write(join(lib, 'auth', 'ng-package.json'), '{ "lib": { "entryFile": "src/public-api.ts" } }\n');
  write(join(lib, 'auth', 'src', 'public-api.ts'), "export * from './lt-auth.service';\n");
  write(
    join(lib, 'auth', 'src', 'lt-auth.service.ts'),
    "import { LT } from '@lenne.tech/ng-base';\nexport const A = LT;\n",
  );
  // ... and one with its own entry file name.
  write(join(lib, 'ui', 'ng-package.json'), '{ "lib": { "entryFile": "src/index.ts" } }\n');
  write(join(lib, 'ui', 'src', 'index.ts'), 'export const UI = 1;\n');
}

/** An Angular app (ng-base-starter shape) in npm mode. */
function seedAngularApp(dir: string): void {
  write(
    join(dir, 'angular.json'),
    JSON.stringify({
      projects: {
        app: { architect: { build: { options: { styles: ['src/styles.css', { input: 'src/print.css' }] } } } },
      },
    }),
  );
  write(join(dir, 'src', 'styles.css'), "@import 'tailwindcss';\n@import '@lenne.tech/ng-base/ui/styles/theme.css';\n");
  write(join(dir, 'src', 'print.css'), '@import "@lenne.tech/ng-base/ui/styles/theme.css";\n');
  write(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        dependencies: { '@angular/core': '^22.2.0', '@lenne.tech/ng-base': '22.0.0' },
        name: 'app',
        scripts: { check: 'pnpm run lint && pnpm run test' },
      },
      null,
      2,
    )}\n`,
  );
  write(
    join(dir, 'tsconfig.json'),
    [
      '/* To learn more about Typescript configuration file: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html. */',
      '{',
      '  "compilerOptions": {',
      '    // strict by default',
      '    "strict": true,',
      '    "paths": {',
      '      "@app/*": ["./src/app/*"]',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  write(join(dir, 'CLAUDE.md'), '# App\n');
}

function makeHelper(): FrontendHelper {
  const quiet = { error: () => {}, info: () => {}, success: () => {}, warning: () => {} };
  return new FrontendHelper({ filesystem, print: quiet } as never);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lt-ng-base-vendor-')));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('ng-base version and source', () => {
  test('pinnedNgBaseVersion strips range operators and rejects non-versions', () => {
    expect(pinnedNgBaseVersion({ dependencies: { '@lenne.tech/ng-base': '^22.0.0' } })).toBe('22.0.0');
    expect(pinnedNgBaseVersion({ dependencies: { '@lenne.tech/ng-base': '~22.1.3-rc.1' } })).toBe('22.1.3-rc.1');
    expect(pinnedNgBaseVersion({ dependencies: { '@lenne.tech/ng-base': 'workspace:*' } })).toBeUndefined();
    expect(pinnedNgBaseVersion({ dependencies: {} })).toBeUndefined();
  });

  test('ngBaseTag carries the v that ng-base tags carry', () => {
    expect(ngBaseTag('22.0.0')).toBe('v22.0.0');
    expect(ngBaseTag('v22.0.0')).toBe('v22.0.0');
  });

  test('resolveNgBaseLibraryDir accepts the repo root, the library dir and a symlink to either', () => {
    const repo = join(root, 'ng-base');
    seedNgBaseRepo(repo);
    const lib = join(repo, 'projects', 'ng-base');
    expect(resolveNgBaseLibraryDir(repo)).toBe(lib);
    expect(resolveNgBaseLibraryDir(lib)).toBe(lib);
    const link = join(root, 'linked');
    symlinkSync(repo, link);
    expect(resolveNgBaseLibraryDir(link)).toBe(lib);
    // A tree without an ng-package.json whose entry file exists is refused.
    write(join(root, 'legacy', 'projects', 'ng-base', 'src', 'public-api.ts'), '');
    expect(resolveNgBaseLibraryDir(join(root, 'legacy'))).toBeUndefined();
    write(join(root, 'broken', 'projects', 'ng-base', 'ng-package.json'), '{ "lib": { "entryFile": "src/nope.ts" } }');
    expect(resolveNgBaseLibraryDir(join(root, 'broken'))).toBeUndefined();
    expect(resolveNgBaseLibraryDir(join(root, 'missing'))).toBeUndefined();
  });

  test('copyNgBaseSource takes the source and leaves build and test files behind', () => {
    const repo = join(root, 'ng-base');
    seedNgBaseRepo(repo);
    const core = join(root, 'app', 'src', 'core');
    copyNgBaseSource(join(repo, 'projects', 'ng-base'), core);
    expect(filesystem.exists(join(core, 'src', 'public-api.ts'))).toBe('file');
    expect(filesystem.exists(join(core, 'auth', 'src', 'lt-auth.service.ts'))).toBe('file');
    // The ng-package.json files stay: the tsconfig mapping is derived from them.
    expect(filesystem.exists(join(core, 'ng-package.json'))).toBe('file');
    expect(filesystem.exists(join(core, 'auth', 'ng-package.json'))).toBe('file');
    for (const gone of [
      'package.json',
      'tsconfig.lib.json',
      'README.md',
      'CLAUDE.md',
      'src/lib/config.spec.ts',
      'src/test-setup.ts',
    ]) {
      expect(filesystem.exists(join(core, gone))).toBe(false);
    }
    expect(ngBaseEntryPoints(core)).toEqual(['auth', 'ui']);
  });

  test('copyNgBaseSource never follows a symlink inside the source', () => {
    const repo = join(root, 'ng-base');
    seedNgBaseRepo(repo);
    write(join(root, 'secret.txt'), 'do not copy\n');
    symlinkSync(join(root, 'secret.txt'), join(repo, 'projects', 'ng-base', 'leak.ts'));
    const core = join(root, 'app', 'src', 'core');
    copyNgBaseSource(join(repo, 'projects', 'ng-base'), core);
    expect(filesystem.exists(join(core, 'leak.ts'))).toBe(false);
  });
});

describe('tsconfig paths', () => {
  /** The app with ng-base copied into src/core/, as the conversion leaves it before the tsconfig step. */
  function seedVendoredApp(): string {
    const repo = join(root, 'ng-base');
    const app = join(root, 'app');
    seedNgBaseRepo(repo);
    seedAngularApp(app);
    copyNgBaseSource(join(repo, 'projects', 'ng-base'), join(app, 'src', 'core'));
    return app;
  }

  const tsconfigPaths = (app: string): Record<string, string[]> =>
    JSON.parse(
      readFileSync(join(app, 'tsconfig.json'), 'utf8')
        .replace(/^\/\*.*\*\/$/m, '')
        .replace(/\/\/.*$/gm, ''),
    ).compilerOptions.paths;

  test('the mapping is derived from every ng-package.json and its lib.entryFile', () => {
    const app = seedVendoredApp();
    expect(ngBaseTsconfigPaths(join(app, 'src', 'core'))).toEqual({
      '@lenne.tech/ng-base': ['./src/core/src/public-api.ts'],
      '@lenne.tech/ng-base/auth': ['./src/core/auth/src/public-api.ts'],
      '@lenne.tech/ng-base/ui': ['./src/core/ui/src/index.ts'],
    });
  });

  test('an entry file outside its directory or missing on disk is not mapped', () => {
    const lib = join(root, 'lib');
    // No lib.entryFile: ng-packagr's own default, src/public_api.ts (underscore).
    write(join(lib, 'ng-package.json'), '{}');
    write(join(lib, 'src', 'public_api.ts'), '');
    write(join(lib, 'evil', 'ng-package.json'), '{ "lib": { "entryFile": "../../outside.ts" } }');
    write(join(root, 'outside.ts'), '');
    write(join(lib, 'gone', 'ng-package.json'), '{ "lib": { "entryFile": "src/missing.ts" } }');
    expect(Object.keys(ngBaseTsconfigPaths(lib))).toEqual(['@lenne.tech/ng-base']);
  });

  test('vendor sets the derived mapping and keeps comments and other paths; npm removes every ng-base key', () => {
    const app = seedVendoredApp();
    const before = readFileSync(join(app, 'tsconfig.json'), 'utf8');

    expect(setNgBaseTsconfigPaths(app, 'vendor')).toBe('changed');
    const vendored = readFileSync(join(app, 'tsconfig.json'), 'utf8');
    expect(vendored).toContain('// strict by default');
    expect(tsconfigPaths(app)).toEqual({
      '@app/*': ['./src/app/*'],
      ...ngBaseTsconfigPaths(join(app, 'src', 'core')),
    });
    expect(setNgBaseTsconfigPaths(app, 'vendor')).toBe('unchanged');

    // An entry point that went away upstream loses its mapping on the next run.
    rmSync(join(app, 'src', 'core', 'ui'), { force: true, recursive: true });
    expect(setNgBaseTsconfigPaths(app, 'vendor')).toBe('changed');
    expect(tsconfigPaths(app)['@lenne.tech/ng-base/ui']).toBeUndefined();

    expect(setNgBaseTsconfigPaths(app, 'npm')).toBe('changed');
    const back = readFileSync(join(app, 'tsconfig.json'), 'utf8');
    expect(back).not.toContain('@lenne.tech/ng-base');
    expect(back).toContain('"@app/*"');
    expect(JSON.parse(back.replace(/^\/\*.*\*\/$/m, '').replace(/\/\/.*$/gm, ''))).toEqual(
      JSON.parse(before.replace(/^\/\*.*\*\/$/m, '').replace(/\/\/.*$/gm, '')),
    );
  });

  test('an unparseable tsconfig is left alone', () => {
    const app = join(root, 'app');
    write(join(app, 'tsconfig.json'), '{ "compilerOptions": { ');
    expect(setNgBaseTsconfigPaths(app, 'vendor')).toBe('unparseable');
    expect(readFileSync(join(app, 'tsconfig.json'), 'utf8')).toBe('{ "compilerOptions": { ');
  });
});

describe('dependencies and markers', () => {
  test('applyVendorDependencies swaps the package for its peers, never overriding a declared one', () => {
    const pkg: Record<string, any> = {
      dependencies: { '@angular/core': '^22.2.1', '@lenne.tech/ng-base': '^22.0.0' },
      devDependencies: {},
    };
    const added = applyVendorDependencies(pkg, {
      dependencies: { tslib: '^2.8.0' },
      peerDependencies: {
        '@angular/core': '^22.2.0',
        '@playwright/test': '>=1.50.0',
        'better-auth': '>=1.7.16 <1.8.0',
      },
    });
    expect(added.sort()).toEqual(['@playwright/test', 'better-auth', 'tslib']);
    expect(pkg.dependencies).toEqual({ '@angular/core': '^22.2.1', 'better-auth': '>=1.7.16 <1.8.0', tslib: '^2.8.0' });
    expect(pkg.devDependencies).toEqual({ '@playwright/test': '>=1.50.0' });
  });

  test('applyVendorDependencies drops the dependenciesMeta entry of the injected build', () => {
    const pkg: Record<string, any> = {
      dependencies: { '@lenne.tech/ng-base': 'file:../ng-base/dist/ng-base' },
      dependenciesMeta: { '@lenne.tech/ng-base': { injected: true } },
    };
    applyVendorDependencies(pkg, {});
    expect(pkg.dependenciesMeta).toBeUndefined();
    const keep: Record<string, any> = {
      dependenciesMeta: { '@lenne.tech/ng-base': { injected: true }, other: { injected: true } },
    };
    applyVendorDependencies(keep, {});
    expect(keep.dependenciesMeta).toEqual({ other: { injected: true } });
  });

  test('an ng-base VENDOR.md is never read as a vendored nest-server (both live in src/core/)', () => {
    const app = join(root, 'app');
    write(
      join(app, 'src', 'core', 'VENDOR.md'),
      buildNgBaseVendorMd({ date: '2026-11-06', source: 'test', version: '22.0.0' }),
    );
    expect(isVendoredNgBaseProject(app)).toBe(true);
    expect(isVendoredProject(app)).toBe(false);
  });
});

describe('FrontendHelper round trip', () => {
  test('vendor from a local checkout, then back to npm', async () => {
    const repo = join(root, 'ng-base');
    const app = join(root, 'app');
    seedNgBaseRepo(repo);
    seedAngularApp(app);
    const helper = makeHelper();

    const result = await helper.convertAngularAppToVendored({ dest: app, localSource: repo });
    expect(result.version).toBe('22.0.0');
    expect(result.entryPoints).toEqual(['auth', 'ui']);
    expect(detectFrontendFramework(app)).toEqual({ kind: 'angular', mode: 'vendor' });
    const vendoredPkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
    expect(vendoredPkg.dependencies['@lenne.tech/ng-base']).toBeUndefined();
    expect(vendoredPkg.dependencies['better-auth']).toBe('>=1.7.16 <1.8.0');
    expect(vendoredPkg.scripts['check:vendor-freshness']).toContain('src/core/VENDOR.md');
    expect(vendoredPkg.scripts.check).toBe('pnpm run check:vendor-freshness && pnpm run lint && pnpm run test');
    expect(readFileSync(join(app, 'src', 'core', 'LICENSE'), 'utf8')).toBe('MIT\n');
    expect(readFileSync(join(app, 'src', 'core', 'VENDOR.md'), 'utf8')).toContain('Baseline-Version:** 22.0.0');
    expect(readFileSync(join(app, 'CLAUDE.md'), 'utf8')).toContain('`@lenne.tech/ng-base` library');
    // tsconfig paths reach TypeScript only; Tailwind resolves CSS imports from node_modules.
    expect(readFileSync(join(app, 'src', 'styles.css'), 'utf8')).toContain("@import './core/ui/styles/theme.css';");
    expect(readFileSync(join(app, 'src', 'print.css'), 'utf8')).toContain('@import "./core/ui/styles/theme.css";');
    await expect(helper.convertAngularAppToVendored({ dest: app, localSource: repo })).rejects.toThrow(
      'already in vendor mode',
    );

    const back = await helper.convertAngularAppToNpmMode({ dest: app });
    expect(back.version).toBe('22.0.0');
    expect(filesystem.exists(join(app, 'src', 'core'))).toBe(false);
    expect(detectFrontendFramework(app)).toEqual({ kind: 'angular', mode: 'npm' });
    const npmPkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
    // Exact, as the starter pins it: its check-ng-base-pin.mjs fails a range in CI.
    expect(npmPkg.dependencies['@lenne.tech/ng-base']).toBe('22.0.0');
    expect(npmPkg.scripts['check:vendor-freshness']).toBeUndefined();
    expect(npmPkg.scripts.check).toBe('pnpm run lint && pnpm run test');
    expect(readFileSync(join(app, 'tsconfig.json'), 'utf8')).not.toContain('@lenne.tech/ng-base');
    expect(readFileSync(join(app, 'CLAUDE.md'), 'utf8')).not.toContain('Vendor-Mode Notice');
    expect(readFileSync(join(app, 'src', 'styles.css'), 'utf8')).toBe(
      "@import 'tailwindcss';\n@import '@lenne.tech/ng-base/ui/styles/theme.css';\n",
    );
    expect(readFileSync(join(app, 'src', 'print.css'), 'utf8')).toBe(
      '@import "@lenne.tech/ng-base/ui/styles/theme.css";\n',
    );
  });

  test('a local source that is no ng-base checkout fails before anything is written', async () => {
    const app = join(root, 'app');
    seedAngularApp(app);
    const before = readFileSync(join(app, 'package.json'), 'utf8');
    await expect(
      makeHelper().convertAngularAppToVendored({ dest: app, localSource: join(root, 'nope') }),
    ).rejects.toThrow('is no ng-base source');
    expect(readFileSync(join(app, 'package.json'), 'utf8')).toBe(before);
    expect(filesystem.exists(join(app, 'src', 'core'))).toBe(false);
  });

  test('workspace mode removes exactly the starter repo-only files', () => {
    const app = join(root, 'app');
    seedAngularApp(app);
    for (const file of [
      'CHANGELOG.md',
      '.github/workflows/ci.yml',
      'extras/sync.mjs',
      'migration-guides/22.md',
      '.release-it.json',
      'scripts/release.mjs',
      'package-lock.json',
    ]) {
      write(join(app, file), 'x\n');
    }
    write(join(app, 'scripts', 'dev.mjs'), 'x\n');
    const removed = makeHelper().removeAngularStarterRepoFiles(app);
    expect(removed.sort()).toEqual(
      [
        '.github',
        '.release-it.json',
        'CHANGELOG.md',
        'extras',
        'migration-guides',
        'package-lock.json',
        join('scripts', 'release.mjs'),
      ].sort(),
    );
    expect(filesystem.exists(join(app, 'scripts', 'dev.mjs'))).toBe('file');
    expect(filesystem.exists(join(app, 'angular.json'))).toBe('file');
  });
});

describe('stylesheet imports', () => {
  test('a symlinked stylesheet is not written through', () => {
    const app = join(root, 'app');
    seedAngularApp(app);
    write(join(root, 'outside.css'), "@import '@lenne.tech/ng-base/ui/styles/theme.css';\n");
    rmSync(join(app, 'src', 'print.css'));
    symlinkSync(join(root, 'outside.css'), join(app, 'src', 'print.css'));
    expect(rewriteNgBaseStyleImports(app, 'vendor')).toEqual(['src/styles.css']);
    expect(readFileSync(join(root, 'outside.css'), 'utf8')).toContain('@lenne.tech/ng-base/');
  });
});

describe('npm mode against a local ng-base build', () => {
  test('resolves the dist named by the root ng-package.json dest, refuses a missing build', () => {
    const repo = join(root, 'ng-base');
    seedNgBaseRepo(repo);
    expect(resolveLocalNgBaseBuild(repo).error).toContain(join(repo, 'dist', 'ng-base', 'package.json'));
    write(
      join(repo, 'dist', 'ng-base', 'package.json'),
      JSON.stringify({ name: '@lenne.tech/ng-base', version: '22.0.0' }),
    );
    expect(resolveLocalNgBaseBuild(repo)).toEqual({ distDir: join(repo, 'dist', 'ng-base') });
    expect(resolveLocalNgBaseBuild(join(root, 'nope')).error).toContain('is no ng-base checkout');
  });

  test('writes an injected file: dependency, never a link', () => {
    const pkg: Record<string, any> = {
      dependencies: { '@angular/core': '^22.2.0', '@lenne.tech/ng-base': '^22.0.0' },
      dependenciesMeta: { other: { injected: true } },
    };
    applyLocalNgBaseDependency(pkg, '/work/ng-base/dist/ng-base');
    expect(pkg.dependencies['@lenne.tech/ng-base']).toBe('file:/work/ng-base/dist/ng-base');
    expect(pkg.dependenciesMeta).toEqual({ '@lenne.tech/ng-base': { injected: true }, other: { injected: true } });
  });

  test('back to npm from vendor mode can use the local build instead of the registry', async () => {
    const repo = join(root, 'ng-base');
    const app = join(root, 'app');
    seedNgBaseRepo(repo);
    seedAngularApp(app);
    write(join(repo, 'dist', 'ng-base', 'package.json'), JSON.stringify({ name: '@lenne.tech/ng-base' }));
    const helper = makeHelper();
    await helper.convertAngularAppToVendored({ dest: app, localSource: repo });
    await helper.convertAngularAppToNpmMode({ dest: app, localSource: repo });
    const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@lenne.tech/ng-base']).toBe(`file:${join(repo, 'dist', 'ng-base')}`);
    expect(pkg.dependenciesMeta['@lenne.tech/ng-base']).toEqual({ injected: true });
  });
});
