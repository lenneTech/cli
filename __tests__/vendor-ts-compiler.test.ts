/**
 * `migrations-utils/ts-compiler.js` registers ts-node for the migrate CLI of a
 * vendor-mode project. The version earlier CLIs generated read the project's
 * tsconfig.json and overrode `module: commonjs` on top of it, which a TypeScript 6
 * project on `moduleResolution: nodenext` (nest-server 12's recommendation) turns
 * into TS5110: every `migrate:*` run fails before a migration is loaded.
 *
 * The first block runs the REAL file under the CLI's own ts-node + TypeScript, the
 * same pair a generated project installs, because the defect is a compiler option
 * diagnostic and nothing short of the compiler reports it. Fixtures live in the OS
 * tmpdir so git sees no `.gitignore` of this repo.
 */
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { healVendorTsCompiler, LEGACY_VENDOR_TS_COMPILER } from '../src/lib/heal-vendor-migrate-store';

const TEMPLATE_PATH = join(__dirname, '..', 'src', 'templates', 'vendor-scripts', 'ts-compiler.js');
const CLI_NODE_MODULES = join(__dirname, '..', 'node_modules');

const TSCONFIGS: Record<string, null | object> = {
  // nest-server 12's recommendation (migration guide §2).
  nodenext: {
    compilerOptions: {
      module: 'nodenext',
      moduleResolution: 'nodenext',
      outDir: './dist',
      resolvePackageJsonExports: true,
      strict: false,
      types: ['node', 'vitest/globals'],
    },
  },
  // The starter's tsconfig before nest-server 12.
  commonjs: {
    compilerOptions: { module: 'commonjs', outDir: './dist', target: 'es2022', types: ['vitest/globals'] },
  },
  none: null,
};

/** A migration-shaped file: decorator, parameter property, relative import. */
const MIGRATION = [
  "import { label } from './label';",
  'function Marker(): ClassDecorator {',
  '  return () => undefined;',
  '}',
  '@Marker()',
  'export class Migration {',
  '  constructor(private readonly name: string = label()) {}',
  '  up(): string {',
  '    return `up ${this.name}`;',
  '  }',
  '}',
  'console.log(new Migration().up());',
  '',
].join('\n');

describe('vendor ts-compiler.js under a real ts-node', () => {
  let projectDir: string;

  const run = (bootstrap: string, tsconfig: null | object): { output: string; status: null | number } => {
    writeFileSync(join(projectDir, 'migrations-utils', 'ts-compiler.js'), bootstrap, 'utf8');
    const tsconfigPath = join(projectDir, 'tsconfig.json');
    if (tsconfig) {
      writeFileSync(tsconfigPath, JSON.stringify(tsconfig), 'utf8');
    } else if (existsSync(tsconfigPath)) {
      rmSync(tsconfigPath);
    }
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        [
          "const register = require('./migrations-utils/ts-compiler');",
          // `--compiler ts:<file>` calls the export as well (when it is a function, like the
          // migrate CLI does); it must be idempotent.
          "if (typeof register === 'function') register();",
          "require('./migrations/0001-demo.ts');",
          "console.log('ts-node registered:', Boolean(process[Symbol.for('ts-node.register.instance')]));",
        ].join(' '),
      ],
      { cwd: projectDir, encoding: 'utf8' },
    );
    return { output: `${result.stdout}${result.stderr}`, status: result.status };
  };

  const coreLoaderPath = (): string =>
    join(projectDir, 'src', 'core', 'modules', 'migrate', 'helpers', 'ts-compiler.js');
  const writeCoreLoader = (content: string): void => {
    mkdirSync(dirname(coreLoaderPath()), { recursive: true });
    writeFileSync(coreLoaderPath(), content, 'utf8');
  };

  afterEach(() => {
    rmSync(join(projectDir, 'src'), { force: true, recursive: true });
  });

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'lt-ts-compiler-'));
    writeFileSync(join(projectDir, 'package.json'), '{"name":"vendored","private":true}\n', 'utf8');
    mkdirSync(join(projectDir, 'migrations-utils'));
    mkdirSync(join(projectDir, 'migrations'));
    writeFileSync(join(projectDir, 'migrations', '0001-demo.ts'), MIGRATION, 'utf8');
    writeFileSync(join(projectDir, 'migrations', 'label.ts'), "export const label = (): string => 'demo';\n", 'utf8');
    // The project's own ts-node + typescript, as `pnpm install` would provide them.
    // `junction`: needs no symlink privilege on Windows, ignored on POSIX.
    symlinkSync(CLI_NODE_MODULES, join(projectDir, 'node_modules'), 'junction');
  });

  afterAll(() => {
    rmSync(projectDir, { force: true, recursive: true });
  });

  it.each(Object.keys(TSCONFIGS))('loads a .ts migration with a %s project tsconfig', (name) => {
    const result = run(readFileSync(TEMPLATE_PATH, 'utf8'), TSCONFIGS[name]);
    expect(result.output).toContain('up demo');
    expect(result.status).toBe(0);
  });

  it('counter-check: the version earlier CLIs generated fails on the nodenext tsconfig with TS5110', () => {
    const result = run(LEGACY_VENDOR_TS_COMPILER, TSCONFIGS.nodenext);
    expect(result.output).toContain('TS5110');
    expect(result.status).not.toBe(0);
  });

  it("delegates to a nest-server >= 12 core's own loader and never registers ts-node", () => {
    // Shaped like nest-server 12's SWC loader: registers on require, marks its hook, exports an
    // idempotent register(). It transpiles with TypeScript here only because the CLI has no @swc/core.
    writeCoreLoader(
      [
        "const Module = require('node:module');",
        "const fs = require('node:fs');",
        "const ts = require('typescript');",
        "const MARKER = Symbol.for('lenne.tech/nest-server/ts-compiler');",
        'function register() {',
        "  if (Module._extensions['.ts'] && Module._extensions['.ts'][MARKER]) return;",
        '  function compile(module, filename) {',
        '    const options = { emitDecoratorMetadata: true, experimentalDecorators: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };',
        "    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: options, fileName: filename }).outputText, filename);",
        '  }',
        '  compile[MARKER] = true;',
        "  Module._extensions['.ts'] = compile;",
        "  console.log('core loader registered');",
        '}',
        'register();',
        'module.exports = register;',
        '',
      ].join('\n'),
    );

    const result = run(readFileSync(TEMPLATE_PATH, 'utf8'), TSCONFIGS.nodenext);
    expect(result.output).toContain('core loader registered');
    expect(result.output).toContain('up demo');
    expect(result.output).toContain('ts-node registered: false');
    expect(result.status).toBe(0);
  });

  it('registers ts-node itself next to an older core, whose loader only re-exports ts-node', () => {
    // nest-server <= 11: same path, but requiring it registers nothing.
    writeCoreLoader("const tsNode = require('ts-node');\nmodule.exports = tsNode.register;\n");

    const result = run(readFileSync(TEMPLATE_PATH, 'utf8'), TSCONFIGS.commonjs);
    expect(result.output).toContain('up demo');
    expect(result.output).toContain('ts-node registered: true');
    expect(result.status).toBe(0);
  });
});

describe('healVendorTsCompiler', () => {
  let apiDir: string;
  let asset: string;
  const target = (): string => join(apiDir, 'migrations-utils', 'ts-compiler.js');
  const writeFile = (path: string, content: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  };
  const makeVendored = (): void => writeFile(join(apiDir, 'src', 'core', 'VENDOR.md'), '# Vendor');
  const git = (...args: string[]): void => {
    execFileSync('git', ['-C', apiDir, ...args], { stdio: 'ignore' });
  };
  const commitAll = (): void => {
    git('init');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('add', '-A');
    git('commit', '-m', 'init');
  };

  beforeEach(() => {
    apiDir = mkdtempSync(join(tmpdir(), 'lt-heal-ts-compiler-'));
    asset = TEMPLATE_PATH;
  });

  afterEach(() => {
    rmSync(apiDir, { force: true, recursive: true });
  });

  it('replaces the exact file an earlier CLI generated', () => {
    makeVendored();
    writeFile(target(), LEGACY_VENDOR_TS_COMPILER);

    const changed = healVendorTsCompiler(apiDir, asset);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('TS5110');
    expect(readFileSync(target(), 'utf8')).toBe(readFileSync(TEMPLATE_PATH, 'utf8'));
  });

  it('leaves an ES module project alone: the CommonJS template would be loaded as ESM there too', () => {
    makeVendored();
    writeFile(join(apiDir, 'package.json'), '{ "type": "module" }');
    writeFile(target(), LEGACY_VENDOR_TS_COMPILER);

    const changed = healVendorTsCompiler(apiDir, asset);

    expect(changed).toEqual([expect.stringContaining('skipped: ES module project')]);
    expect(readFileSync(target(), 'utf8')).toBe(LEGACY_VENDOR_TS_COMPILER);
  });

  it('also recognises it with CRLF line endings (Windows checkout)', () => {
    makeVendored();
    writeFile(target(), LEGACY_VENDOR_TS_COMPILER.replace(/\n/g, '\r\n'));

    expect(healVendorTsCompiler(apiDir, asset)).toHaveLength(1);
    expect(readFileSync(target(), 'utf8')).toBe(readFileSync(TEMPLATE_PATH, 'utf8'));
  });

  it('is idempotent — the second run finds nothing to do', () => {
    makeVendored();
    writeFile(target(), LEGACY_VENDOR_TS_COMPILER);
    healVendorTsCompiler(apiDir, asset);

    expect(healVendorTsCompiler(apiDir, asset)).toEqual([]);
  });

  it('leaves a file the project edited alone, however small the edit', () => {
    makeVendored();
    const edited = LEGACY_VENDOR_TS_COMPILER.replace("target: 'es2022'", "target: 'es2023'");
    writeFile(target(), edited);

    expect(healVendorTsCompiler(apiDir, asset)).toEqual([]);
    expect(readFileSync(target(), 'utf8')).toBe(edited);
  });

  it('replaces a tracked, clean file and writes no .bak', () => {
    makeVendored();
    writeFile(target(), LEGACY_VENDOR_TS_COMPILER);
    commitAll();

    expect(healVendorTsCompiler(apiDir, asset)).toHaveLength(1);
    expect(existsSync(`${target()}.bak`)).toBe(false);
  });

  it('skips a tracked file with uncommitted changes', () => {
    makeVendored();
    writeFile(target(), '// committed version\n');
    commitAll();
    writeFile(target(), LEGACY_VENDOR_TS_COMPILER);

    const changed = healVendorTsCompiler(apiDir, asset);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('skipped: uncommitted changes');
    expect(readFileSync(target(), 'utf8')).toBe(LEGACY_VENDOR_TS_COMPILER);
  });

  it('never writes through a symlink', () => {
    makeVendored();
    const outside = join(apiDir, 'outside.js');
    writeFileSync(outside, LEGACY_VENDOR_TS_COMPILER, 'utf8');
    mkdirSync(join(apiDir, 'migrations-utils'), { recursive: true });
    symlinkSync(outside, target());

    const changed = healVendorTsCompiler(apiDir, asset);
    expect(changed[0]).toContain('symlink');
    expect(readFileSync(outside, 'utf8')).toBe(LEGACY_VENDOR_TS_COMPILER);
  });

  it('never writes through a symlink a repository planted at the temp path', () => {
    // The temp file used to be `<file>.lt-tmp`, a name a cloned repository could commit
    // as a symlink: writeFileSync followed it and overwrote a file outside the project.
    makeVendored();
    writeFile(target(), LEGACY_VENDOR_TS_COMPILER);
    const outside = join(apiDir, 'outside-victim.txt');
    writeFileSync(outside, 'precious', 'utf8');
    symlinkSync(outside, `${target()}.lt-tmp`);

    const changed = healVendorTsCompiler(apiDir, asset);

    expect(readFileSync(outside, 'utf8')).toBe('precious');
    expect(changed).toHaveLength(1);
    expect(readFileSync(target(), 'utf8')).toBe(readFileSync(TEMPLATE_PATH, 'utf8'));
  });

  it('ignores npm-mode projects (no src/core/VENDOR.md)', () => {
    writeFile(target(), LEGACY_VENDOR_TS_COMPILER);

    expect(healVendorTsCompiler(apiDir, asset)).toEqual([]);
    expect(readFileSync(target(), 'utf8')).toBe(LEGACY_VENDOR_TS_COMPILER);
  });

  it('does nothing without a ts-compiler.js or without the bundled template', () => {
    makeVendored();
    expect(healVendorTsCompiler(apiDir, asset)).toEqual([]);

    writeFile(target(), LEGACY_VENDOR_TS_COMPILER);
    expect(healVendorTsCompiler(apiDir, join(apiDir, 'missing.js'))).toEqual([]);
    expect(readFileSync(target(), 'utf8')).toBe(LEGACY_VENDOR_TS_COMPILER);
  });
});
