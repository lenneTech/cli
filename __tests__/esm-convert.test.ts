/**
 * `lt server convert-esm` end to end on the file level, against a fixture shaped like
 * nest-server-starter (npm mode) and its vendored variant. The type-checked steps (TS1272, cycles,
 * named imports) have their own suites and need installed dependencies, so `analyze: false` here;
 * measured on real projects: nest-server-starter on a nest-server 12 tarball, npm and vendor mode,
 * converted, built, started, migrated, and their unit and e2e suites green (2026-10-26).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import * as syntax from '../src/lib/esm-commonjs-syntax';
import { convertProjectToEsm, VENDOR_ESM_STORE } from '../src/lib/esm-convert';

function fixture(files: Record<string, string | undefined>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-esm-convert-'));
  for (const [path, text] of Object.entries(files)) {
    if (text === undefined) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const STARTER = {
  'migrations-utils/migrate.js': [
    "const { createMigrationStore } = require('@lenne.tech/nest-server');",
    "const { resolveMongoUri } = require('./mongo-uri');",
    "module.exports = createMigrationStore(resolveMongoUri(), 'migrations');",
    '',
  ].join('\n'),
  'migrations-utils/mongo-uri.js': [
    'function resolveMongoUri() {',
    "  return require('../src/config.env').mongoose.uri;",
    '}',
    'module.exports = { resolveMongoUri };',
    '',
  ].join('\n'),
  'nodemon.json': '{\n  "exec": "ts-node -r tsconfig-paths/register src/main.ts"\n}\n',
  'package.json': JSON.stringify(
    {
      name: 'api',
      scripts: {
        'migrate:up':
          'migrate up --store ./migrations-utils/migrate.js --compiler ts:./node_modules/@lenne.tech/nest-server/dist/core/modules/migrate/helpers/ts-compiler.js',
        'start:nodemon': 'ts-node -r tsconfig-paths/register src/main.ts',
      },
    },
    null,
    2,
  ),
  'src/config.env.ts': [
    "import { join } from 'path';",
    "import metaData = require('./meta.json');",
    "export default { templates: join(__dirname, 'assets'), version: metaData.version };",
    '',
  ].join('\n'),
  'src/main.ts': "import { ServerModule } from './server/server.module';\nexport const m = ServerModule;\n",
  'src/meta.json': '{ "version": "1.0.0" }',
  'src/server/server.module.ts': "import { UserModule } from './modules/user';\nexport class ServerModule { u = UserModule; }\n",
  'src/server/modules/user/index.ts': 'export class UserModule {}\n',
  'tsconfig.json': '{\n  "compilerOptions": {\n    "module": "commonjs",\n    // comment\n    "outDir": "./dist"\n  }\n}\n',
  'vitest.config.ts': "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: {} });\n",
};

describe('convertProjectToEsm', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { force: true, recursive: true }));

  it('converts an npm-mode starter-shaped project on the file level', () => {
    dir = fixture(STARTER);

    const result = convertProjectToEsm({ analyze: false, apiDir: dir, checkNamedImports: false, dryRun: false, mode: 'npm' });

    const read = (path: string) => readFileSync(join(dir, path), 'utf8');
    const loader = './node_modules/@lenne.tech/nest-server/dist/core/modules/migrate/helpers/ts-compiler.js';
    expect(JSON.parse(read('package.json')).type).toBe('module');
    expect(JSON.parse(read('package.json')).scripts['start:nodemon']).toBe(`node -r ${loader} src/main.ts`);
    expect(JSON.parse(read('nodemon.json')).exec).toBe(`node -r ${loader} src/main.ts`);
    expect(read('tsconfig.json')).toContain('"moduleResolution": "nodenext"');
    expect(read('tsconfig.json')).toContain('// comment');
    expect(read('src/main.ts')).toContain("from './server/server.module.js'");
    expect(read('src/server/server.module.ts')).toContain("from './modules/user/index.js'");
    expect(read('src/config.env.ts')).toContain("import metaData from './meta.json' with { type: 'json' };");
    expect(read('src/config.env.ts')).toContain('join(import.meta.dirname, ');
    expect(read('migrations-utils/migrate.js')).toContain("export default createMigrationStore(resolveMongoUri(), 'migrations');");
    expect(read('migrations-utils/migrate.js')).toContain("from './mongo-uri.js'");
    expect(read('migrations-utils/mongo-uri.js')).toContain('const require = createRequire(import.meta.url);');
    expect(read('vitest.config.ts')).toContain('resolve: { extensions:');
    expect(result.findings).toEqual([]);
  });

  it('writes nothing when a rewrite fails part-way: no "type": "module" over unconverted sources', () => {
    dir = fixture(STARTER);
    const before = (path: string) => readFileSync(join(dir, path), 'utf8');
    const pkg = before('package.json');
    const tsconfig = before('tsconfig.json');
    const spy = jest.spyOn(syntax, 'convertCommonJsSyntax').mockImplementation(() => {
      throw new Error('rewrite failed');
    });
    try {
      expect(() =>
        convertProjectToEsm({ analyze: false, apiDir: dir, checkNamedImports: false, dryRun: false, mode: 'npm' }),
      ).toThrow('rewrite failed');
    } finally {
      spy.mockRestore();
    }
    expect(before('package.json')).toBe(pkg);
    expect(before('tsconfig.json')).toBe(tsconfig);
    expect(before('nodemon.json')).toBe(STARTER['nodemon.json']);
  });

  it('is idempotent: a second run changes nothing', () => {
    dir = fixture(STARTER);
    convertProjectToEsm({ analyze: false, apiDir: dir, checkNamedImports: false, dryRun: false, mode: 'npm' });
    const second = convertProjectToEsm({ analyze: false, apiDir: dir, checkNamedImports: false, dryRun: false, mode: 'npm' });
    expect(second.changes).toEqual([]);
  });

  it('writes nothing in a dry run', () => {
    dir = fixture(STARTER);
    const before = readFileSync(join(dir, 'src/main.ts'), 'utf8');
    const plan = convertProjectToEsm({ apiDir: dir, checkNamedImports: false, dryRun: true, mode: 'npm' });
    expect(plan.changes.length).toBeGreaterThan(5);
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toBe(before);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).type).toBeUndefined();
  });

  // The store and bootstrap lt itself writes into a vendored CommonJS project.
  const TEMPLATES = join(__dirname, '..', 'src', 'templates', 'vendor-scripts');
  const LT_STORE = readFileSync(join(TEMPLATES, 'migrate-store.js'), 'utf8');
  const LT_BOOTSTRAP = readFileSync(join(TEMPLATES, 'ts-compiler.js'), 'utf8');
  const vendorFixture = (utils: Record<string, string>) =>
    fixture({
      ...STARTER,
      'migrations-utils/migrate.js': undefined,
      'migrations-utils/mongo-uri.js': undefined,
      ...Object.fromEntries(Object.entries(utils).map(([name, text]) => [`migrations-utils/${name}`, text])),
      'package.json': JSON.stringify({
        name: 'api',
        scripts: { 'migrate:up': 'node ./bin/migrate.js up --compiler ts:./migrations-utils/ts-compiler.js' },
      }),
      'src/core/core.module.ts': 'export class CoreModule {}\n',
      'src/core/index.ts': "export * from './core.module';\n",
      'src/server/server.module.ts': "import { CoreModule } from '../core';\nexport class ServerModule { c = CoreModule; }\n",
    });

  it('vendor mode: lt store replaced, lt bootstrap removed, core loader in the scripts, the core skipped', () => {
    dir = vendorFixture({ 'migrate.js': LT_STORE, 'mongo-uri.js': STARTER['migrations-utils/mongo-uri.js'], 'ts-compiler.js': LT_BOOTSTRAP });

    const result = convertProjectToEsm({ analyze: false, apiDir: dir, checkNamedImports: false, dryRun: false, mode: 'vendor' });

    const read = (path: string) => readFileSync(join(dir, path), 'utf8');
    expect(JSON.parse(read('package.json')).scripts['migrate:up']).toBe(
      'node ./bin/migrate.js up --compiler ts:./src/core/modules/migrate/helpers/ts-compiler.js',
    );
    expect(existsSync(join(dir, 'migrations-utils/ts-compiler.js'))).toBe(false);
    expect(read('migrations-utils/migrate.js')).toBe(VENDOR_ESM_STORE);
    expect(read('src/server/server.module.ts')).toContain("from '../core/index.js'");
    expect(read('src/core/index.ts')).toBe("export * from './core.module';\n"); // the vendored core is upstream's
    expect(result.findings).toEqual([]);
  });

  it("vendor mode: a project's own store keeps its logic, its bootstrap stays, and both are reported", () => {
    // The shape of a real vendored project: its own URI logic, no mongo-uri.js. Replacing it
    // dropped that logic and imported a file the project does not have (review, 2026-10-26).
    const ownStore = [
      'try {',
      "  require.resolve('../src/core/modules/migrate/helpers/migration.helper.js');",
      '} catch {',
      "  require('./ts-compiler');",
      '}',
      "const { createMigrationStore } = require('../src/core/modules/migrate/helpers/migration.helper');",
      "const MONGO_URL = process.env.NSC__MONGOOSE__URI || 'mongodb://127.0.0.1/test';",
      'module.exports = createMigrationStore(MONGO_URL);',
      '',
    ].join('\n');
    dir = vendorFixture({ 'migrate.js': ownStore, 'ts-compiler.js': LT_BOOTSTRAP });

    const result = convertProjectToEsm({ analyze: false, apiDir: dir, checkNamedImports: false, dryRun: false, mode: 'vendor' });

    expect(readFileSync(join(dir, 'migrations-utils/migrate.js'), 'utf8')).toBe(ownStore);
    expect(readFileSync(join(dir, 'migrations-utils/ts-compiler.js'), 'utf8')).toBe(LT_BOOTSTRAP);
    expect(result.findings).toEqual([
      expect.objectContaining({ file: 'migrations-utils/migrate.js', message: expect.stringContaining('not the store lt generated') }),
    ]);
  });

  it("vendor mode: a bootstrap that is not lt's is reported, never deleted", () => {
    dir = vendorFixture({
      'migrate.js': LT_STORE,
      'mongo-uri.js': STARTER['migrations-utils/mongo-uri.js'],
      'ts-compiler.js': "module.exports = require('./custom-loader');\n",
    });

    const result = convertProjectToEsm({ analyze: false, apiDir: dir, checkNamedImports: false, dryRun: false, mode: 'vendor' });

    expect(readFileSync(join(dir, 'migrations-utils/ts-compiler.js'), 'utf8')).toBe("module.exports = require('./custom-loader');\n");
    expect(result.findings).toEqual([
      expect.objectContaining({ file: 'migrations-utils/ts-compiler.js', message: expect.stringContaining("not lt's generated bootstrap") }),
    ]);
  });

  it('vendor mode: a dry run deletes and overwrites nothing', () => {
    dir = vendorFixture({ 'migrate.js': LT_STORE, 'mongo-uri.js': STARTER['migrations-utils/mongo-uri.js'], 'ts-compiler.js': LT_BOOTSTRAP });

    const plan = convertProjectToEsm({ apiDir: dir, checkNamedImports: false, dryRun: true, mode: 'vendor' });

    expect(plan.changes).toEqual(expect.arrayContaining([expect.stringContaining('migrations-utils/ts-compiler.js: removed')]));
    expect(readFileSync(join(dir, 'migrations-utils/ts-compiler.js'), 'utf8')).toBe(LT_BOOTSTRAP);
    expect(readFileSync(join(dir, 'migrations-utils/migrate.js'), 'utf8')).toBe(LT_STORE);
  });
});
