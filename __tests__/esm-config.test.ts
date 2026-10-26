/**
 * The configuration side of the ES module conversion, against the shapes nest-server-starter
 * ships: a commented tsconfig, a build config with a trailing comma, the ts-node dev start, the
 * CommonJS migration store.
 */
import { Project } from 'ts-morph';

import { convertCommonJsModule } from '../src/lib/esm-commonjs-module';
import {
  convertTsconfigToNodeNext,
  ensureVitestNodeResolution,
  NPM_CORE_LOADER,
  setPackageTypeModule,
  toEsmCommand,
} from '../src/lib/esm-config';

describe('convertTsconfigToNodeNext', () => {
  const ROOT = [
    '{',
    '  "compilerOptions": {',
    '    "module": "commonjs",',
    '    // TypeScript 6 turns `strict` on by default',
    '    "strict": false,',
    '    "outDir": "./dist"',
    '  },',
    '  "exclude": ["node_modules", "dist"]',
    '}',
    '',
  ].join('\n');

  it('switches the root config to nodenext with isolatedModules and keeps the comment', () => {
    const out = convertTsconfigToNodeNext(ROOT, true);
    expect(JSON.parse(out.replace(/\/\/.*$/gm, '')).compilerOptions).toEqual({
      isolatedModules: true,
      module: 'nodenext',
      moduleResolution: 'nodenext',
      outDir: './dist',
      strict: false,
    });
    expect(out).toContain('// TypeScript 6 turns `strict` on by default');
    expect(convertTsconfigToNodeNext(out, true)).toBeUndefined();
  });

  it('leaves an extending config alone unless it sets module itself (trailing comma survives)', () => {
    const build = '{\n  "extends": "./tsconfig.json",\n  "compilerOptions": {\n    "rootDir": "./",\n  },\n}\n';
    expect(convertTsconfigToNodeNext(build, false)).toBeUndefined();
    const own = '{\n  "extends": "./tsconfig.json",\n  "compilerOptions": { "module": "commonjs" }\n}\n';
    expect(convertTsconfigToNodeNext(own, false)).toContain('"moduleResolution": "nodenext"');
  });
});

describe('setPackageTypeModule', () => {
  it('adds "type": "module", is idempotent, and refuses an unknown type', () => {
    const out = setPackageTypeModule('{\n  "name": "api",\n  "version": "1.0.0"\n}\n');
    expect(JSON.parse(out)).toEqual({ name: 'api', type: 'module', version: '1.0.0' });
    expect(setPackageTypeModule(out)).toBeUndefined();
    expect(() => setPackageTypeModule('{ "type": "wasm" }')).toThrow(/neither module nor commonjs/);
  });
});

describe('toEsmCommand', () => {
  it("moves the starter's dev start to the framework loader and drops tsconfig-paths", () => {
    expect(toEsmCommand('ts-node -r tsconfig-paths/register src/main.ts', NPM_CORE_LOADER).command).toBe(
      `node -r ${NPM_CORE_LOADER} src/main.ts`,
    );
    expect(
      toEsmCommand('node --inspect-brk -r ts-node/register -r tsconfig-paths/register src/main.ts', NPM_CORE_LOADER)
        .command,
    ).toBe(`node --inspect-brk -r ${NPM_CORE_LOADER} src/main.ts`);
  });
});

describe('ensureVitestNodeResolution', () => {
  const config = (text: string) => new Project({ useInMemoryFileSystem: true }).createSourceFile('/vitest.config.ts', text);

  it('adds resolve.extensions, keeps an existing one, merges into an existing resolve', () => {
    const bare = config("export default defineConfig({ test: { globals: true } });\n");
    expect(ensureVitestNodeResolution(bare)).toBe('added');
    expect(bare.getFullText()).toContain("resolve: { extensions: ['.js', '.mjs', '.mts', '.ts', '.jsx', '.tsx', '.json'] }");

    const present = config("export default defineConfig({ resolve: { extensions: ['.js'] } });\n");
    expect(ensureVitestNodeResolution(present)).toBe('present');

    const merged = config("export default defineConfig({ resolve: { alias: {} } });\n");
    expect(ensureVitestNodeResolution(merged)).toBe('added');
    expect(merged.getFullText()).toContain('alias: {}');
    expect(merged.getFullText()).toContain("extensions: ['.js'");

    expect(ensureVitestNodeResolution(config('export default {};\n'))).toBe('unrecognised');
  });
});

describe('convertCommonJsModule', () => {
  function jsProject(files: Record<string, string>) {
    const project = new Project({ compilerOptions: { allowJs: true }, useInMemoryFileSystem: true });
    for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
    project.saveSync();
    return { exists: (path: string) => project.getFileSystem().fileExistsSync(path), project };
  }

  it("turns the starter's migration store into an ES module with a default export", () => {
    const { exists, project } = jsProject({
      '/app/migrations-utils/migrate.js': [
        "const { createMigrationStore } = require('@lenne.tech/nest-server');",
        '',
        "const { resolveMongoUri } = require('./mongo-uri');",
        '',
        'module.exports = createMigrationStore(',
        '  resolveMongoUri(),',
        "  'migrations',",
        ');',
        '',
      ].join('\n'),
      '/app/migrations-utils/mongo-uri.js': '',
    });
    const store = project.getSourceFileOrThrow('/app/migrations-utils/migrate.js');

    expect(convertCommonJsModule(store, exists)).toEqual({ changed: true, reported: [] });
    expect(store.getFullText()).toBe(
      [
        "import { createMigrationStore } from '@lenne.tech/nest-server';",
        '',
        "import { resolveMongoUri } from './mongo-uri.js';",
        '',
        'export default createMigrationStore(',
        '  resolveMongoUri(),',
        "  'migrations',",
        ');',
        '',
      ].join('\n'),
    );
  });

  it('keeps a lazy require synchronous through createRequire and exports by name', () => {
    const { exists, project } = jsProject({
      '/app/migrations-utils/mongo-uri.js': [
        'function resolveMongoUri() {',
        "  const config = require('../src/config.env');",
        '  return config.mongoose.uri;',
        '}',
        '',
        'module.exports = { resolveMongoUri };',
        '',
      ].join('\n'),
    });
    const file = project.getSourceFileOrThrow('/app/migrations-utils/mongo-uri.js');

    convertCommonJsModule(file, exists);

    const text = file.getFullText();
    expect(text).toMatch(/^import \{ createRequire \} from 'node:module';\n\nconst require = createRequire\(import\.meta\.url\);/);
    expect(text).toContain("const config = require('../src/config.env');");
    expect(text).toContain('export { resolveMongoUri };');
    expect(text).not.toContain('module.exports');
  });

  it('reports exports.x instead of guessing', () => {
    const { exists, project } = jsProject({ '/app/x.js': 'exports.a = 1;\n' });
    expect(convertCommonJsModule(project.getSourceFileOrThrow('/app/x.js'), exists).reported).toEqual([
      { line: 1, text: 'exports.a = 1' },
    ]);
  });
});

describe('convertCommonJsModule on a file that is already an ES module', () => {
  it('leaves it untouched, so a second run cannot turn a deliberate createRequire back into an import', () => {
    const project = new Project({ compilerOptions: { allowJs: true }, useInMemoryFileSystem: true });
    const store = project.createSourceFile(
      '/app/migrations-utils/migrate.js',
      [
        "import { createRequire } from 'node:module';",
        "import { resolveMongoUri } from './mongo-uri.js';",
        'const require = createRequire(import.meta.url);',
        "const { createMigrationStore } = require('../src/core/modules/migrate/migration.helper');",
        'export default createMigrationStore(resolveMongoUri());',
        '',
      ].join('\n'),
    );
    const before = store.getFullText();

    expect(convertCommonJsModule(store, () => true)).toEqual({ changed: false, reported: [] });
    expect(store.getFullText()).toBe(before);
  });
});
