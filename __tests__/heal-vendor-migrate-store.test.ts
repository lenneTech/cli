/**
 * `healVendorMigrateStore` replaces a file WHOLESALE, and the replacement is not
 * behaviour-neutral: the bundled template hardcodes the collection name and takes
 * its URI from `./mongo-uri`. Healing a store that was actually fine therefore
 * empties the migration ledger and re-runs every historical migration against the
 * live database. Most of the cases below exist to prove it does NOT do that.
 *
 * Fixtures live in the OS tmpdir, not under `__tests__/`. A fixture inside this
 * repo is subject to this repo's `.gitignore`, which silently decides what
 * `git status --porcelain` reports — so the git-recoverability assertions would be
 * testing the CLI's own ignore rules rather than the code under test.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { healVendorMigrateStore } from '../src/lib/heal-vendor-migrate-store';

describe('healVendorMigrateStore', () => {
  let apiDir: string;
  let asset: string;

  /** The canonical template: the ts-node require sits in the catch of a resolve-probe. */
  const TEMPLATE = [
    '// Migration store. Loaded by the migrate CLI via `--store`.',
    "const HELPER = '../src/core/modules/migrate/helpers/migration.helper';",
    '',
    'try {',
    '  require.resolve(`${HELPER}.js`);',
    '} catch {',
    "  require('./ts-compiler');",
    '}',
    '',
    'const { createMigrationStore } = require(HELPER);',
    "const { resolveMongoUri } = require('./mongo-uri');",
    '',
    "module.exports = createMigrationStore(resolveMongoUri(), 'migrations');",
    '',
  ].join('\n');

  /** The broken pre-fix variant: top-level unconditional require, dies in the pruned image. */
  const BROKEN = [
    '// The vendored core is TypeScript-only (no prebuilt dist/). Register ts-node',
    '// before requiring any vendor module.',
    "require('./ts-compiler');",
    '',
    "const { createMigrationStore } = require('../src/core/modules/migrate/helpers/migration.helper');",
    "const config = require('../src/config.env');",
    '',
    "module.exports = createMigrationStore(config.default.mongoose.uri, 'migrations');",
    '',
  ].join('\n');

  const store = (): string => join(apiDir, 'migrations-utils', 'migrate.js');
  const writeFile = (path: string, content: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  };
  const writeStore = (content: string): void => writeFile(store(), content);
  const readStore = (): string => readFileSync(store(), 'utf8');
  const makeVendored = (): void => writeFile(join(apiDir, 'src', 'core', 'VENDOR.md'), '# Vendor');
  const git = (...args: string[]): void => {
    execFileSync('git', ['-C', apiDir, ...args], { stdio: 'ignore' });
  };
  /** Turn the fixture into a real repo with the store committed. */
  const commitAll = (): void => {
    git('init');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('add', '-A');
    git('commit', '-m', 'init');
  };

  beforeEach(() => {
    apiDir = mkdtempSync(join(tmpdir(), 'lt-heal-store-'));
    asset = join(apiDir, '_bundled-migrate-store.js');
    writeFileSync(asset, TEMPLATE, 'utf8');
  });

  afterEach(() => {
    rmSync(apiDir, { force: true, recursive: true });
  });

  describe('heals only a provably unconditional require', () => {
    it('replaces a store whose ts-node require is top-level and unconditional', () => {
      makeVendored();
      writeStore(BROKEN);
      const changed = healVendorMigrateStore(apiDir, asset);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain('migrations-utils/migrate.js');
      expect(readStore()).toBe(TEMPLATE);
    });

    it('is idempotent — a healed store is left alone on the next run', () => {
      makeVendored();
      writeStore(BROKEN);
      healVendorMigrateStore(apiDir, asset);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
    });

    it('leaves the canonical resolve-probe store untouched', () => {
      makeVendored();
      writeStore(TEMPLATE);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
      expect(readStore()).toBe(TEMPLATE);
    });

    it('detects a backtick require — `require(`./ts-compiler`)` breaks identically', () => {
      makeVendored();
      writeStore(['require(`./ts-compiler`);', "module.exports = require('./x');", ''].join('\n'));
      expect(healVendorMigrateStore(apiDir, asset)).toHaveLength(1);
      expect(readStore()).toBe(TEMPLATE);
    });

    it('does not accept a guard that only exists inside a comment', () => {
      // The require here IS top-level and unconditional; the comment is prose.
      makeVendored();
      writeStore(
        [
          '// We could use try { require.resolve(...) } here, but do not.',
          "require('./ts-compiler');",
          "module.exports = require('../src/core/modules/migrate/helpers/migration.helper');",
          '',
        ].join('\n'),
      );
      expect(healVendorMigrateStore(apiDir, asset)).toHaveLength(1);
      expect(readStore()).toBe(TEMPLATE);
    });
  });

  // The expensive lesson: the first implementation asked "can I SEE a guard?" and
  // read "no" as proof that none exists. It knew exactly two shapes, so every
  // other production-safe guard was destroyed — along with the project's own
  // collection name, which empties the ledger and re-runs every migration.
  describe('never touches a store whose require is conditional', () => {
    const guarded = (guard: string, body = "  require('./ts-compiler');"): string =>
      [
        "const fs = require('fs');",
        "const path = require('path');",
        guard,
        body,
        '}',
        '',
        "const { createMigrationStore } = require('../src/core/modules/migrate/helpers/migration.helper');",
        "module.exports = createMigrationStore(process.env.CUSTOM_URI, 'my_project_migrations');",
        '',
      ].join('\n');

    const cases: [string, string][] = [
      ['an existsSync probe', guarded("if (!fs.existsSync(path.join(__dirname, 'x.js'))) {")],
      ['a NODE_ENV check', guarded("if (process.env.NODE_ENV !== 'production') {")],
      ['a try/catch the project wrote itself', guarded('try {', "  require('./ts-compiler');\n} catch {")],
    ];

    it.each(cases)('leaves a store guarded by %s untouched', (_label, source) => {
      makeVendored();
      writeStore(source);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
      expect(readStore()).toBe(source);
      // The part that made this a data-loss bug rather than lost customization.
      expect(readStore()).toContain('my_project_migrations');
      expect(readStore()).toContain('CUSTOM_URI');
    });

    it('leaves a require nested in a function untouched', () => {
      makeVendored();
      const source = [
        'function registerTs() {',
        "  require('./ts-compiler');",
        '}',
        'if (!global.__compiled) registerTs();',
        "module.exports = require('./x');",
        '',
      ].join('\n');
      writeStore(source);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
      expect(readStore()).toBe(source);
    });

    it('leaves a ternary-guarded require untouched', () => {
      makeVendored();
      const source = ["const compiled = false;", "compiled ? null : require('./ts-compiler');", ''].join('\n');
      writeStore(source);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
      expect(readStore()).toBe(source);
    });
  });

  // A regex "lexer" has no string/template/regex-literal state, so a `/*` or `//`
  // inside a literal earlier in the file erased the guard from the analysed text
  // and triggered the overwrite. The AST cannot be fooled this way.
  describe('literals cannot fake or hide a match', () => {
    it('a `/*` inside a string literal does not erase the guard below it', () => {
      makeVendored();
      const source = [
        "const OPEN = '/*';",
        "const CLOSE = '*/';",
        'try {',
        "  require('./ts-compiler');",
        '} catch {}',
        'module.exports = { OPEN, CLOSE };',
        '',
      ].join('\n');
      writeStore(source);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
      expect(readStore()).toBe(source);
    });

    it('a protocol-relative `//` in a string does not erase the guard below it', () => {
      makeVendored();
      const source = [
        "const cdn = '//cdn.example.com';",
        'try {',
        "  require('./ts-compiler');",
        '} catch {}',
        'module.exports = { cdn };',
        '',
      ].join('\n');
      writeStore(source);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
      expect(readStore()).toBe(source);
    });

    it('a require mentioned only inside a string is not a hazard', () => {
      makeVendored();
      const source = ['const doc = "require(\'./ts-compiler\')";', 'module.exports = { doc };', ''].join('\n');
      writeStore(source);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
      expect(readStore()).toBe(source);
    });
  });

  // An overwrite is only acceptable when it can be undone. Empty
  // `git status --porcelain` output does NOT mean "committed" — an ignored or
  // untracked file is equally silent, and those are precisely the cases where
  // nothing is recoverable.
  describe('recoverability guard', () => {
    it('skips a tracked file with uncommitted changes', () => {
      makeVendored();
      writeStore(TEMPLATE);
      commitAll();
      writeStore(BROKEN);

      const changed = healVendorMigrateStore(apiDir, asset);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain('skipped: uncommitted changes');
      expect(readStore()).toBe(BROKEN);
    });

    it('overwrites a tracked, clean file without a .bak — git already has it', () => {
      makeVendored();
      writeStore(BROKEN);
      commitAll();

      const changed = healVendorMigrateStore(apiDir, asset);
      expect(changed).toHaveLength(1);
      expect(changed[0]).not.toContain('.bak');
      expect(readStore()).toBe(TEMPLATE);
      expect(existsSync(`${store()}.bak`)).toBe(false);
    });

    it('writes a .bak when the file is untracked but ignored — git has no copy', () => {
      makeVendored();
      writeStore(BROKEN);
      writeFile(join(apiDir, '.gitignore'), 'migrations-utils/\n');
      commitAll();

      const changed = healVendorMigrateStore(apiDir, asset);
      expect(changed[0]).toContain('.bak');
      expect(readStore()).toBe(TEMPLATE);
      expect(readFileSync(`${store()}.bak`, 'utf8')).toBe(BROKEN);
    });

    it('writes a .bak outside a git repo — nothing could be recovered otherwise', () => {
      makeVendored();
      writeStore(BROKEN);

      const changed = healVendorMigrateStore(apiDir, asset);
      expect(changed[0]).toContain('.bak');
      expect(readStore()).toBe(TEMPLATE);
      expect(readFileSync(`${store()}.bak`, 'utf8')).toBe(BROKEN);
    });

    it('keeps the FIRST .bak — a second run must not clobber the pristine copy', () => {
      makeVendored();
      writeStore(BROKEN);
      healVendorMigrateStore(apiDir, asset);
      // Re-break it, as a botched manual edit would.
      writeStore(`${BROKEN}// later edit\n`);
      healVendorMigrateStore(apiDir, asset);

      expect(readFileSync(`${store()}.bak`, 'utf8')).toBe(BROKEN);
    });
  });

  describe('refuses unsafe targets', () => {
    it('never writes through a symlink', () => {
      makeVendored();
      const outside = join(apiDir, 'outside.js');
      writeFileSync(outside, BROKEN, 'utf8');
      mkdirSync(join(apiDir, 'migrations-utils'), { recursive: true });
      symlinkSync(outside, store());

      const changed = healVendorMigrateStore(apiDir, asset);
      expect(changed[0]).toContain('symlink');
      expect(readFileSync(outside, 'utf8')).toBe(BROKEN);
    });
  });

  describe('scope', () => {
    it('ignores npm-mode projects (no src/core/VENDOR.md)', () => {
      writeStore(BROKEN);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
      expect(readStore()).toBe(BROKEN);
    });

    it('does nothing when the project has no migration store at all', () => {
      makeVendored();
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
    });

    it('does nothing when the bundled template is missing from the CLI build', () => {
      makeVendored();
      writeStore(BROKEN);
      rmSync(asset);
      expect(healVendorMigrateStore(apiDir, asset)).toEqual([]);
      expect(readStore()).toBe(BROKEN);
    });
  });
});
