import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { basename, join, relative } from 'path';
import { Project, SourceFile } from 'ts-morph';

import { VENDOR_CORE_LOADER } from './dev-start-loader';
import { checkNamedImportsAgainstNode, collectEmittedNamedImports } from './esm-cjs-named-imports';
import { convertCommonJsModule } from './esm-commonjs-module';
import { convertCommonJsSyntax } from './esm-commonjs-syntax';
import {
  convertTsconfigToNodeNext,
  ensureVitestNodeResolution,
  NPM_CORE_LOADER,
  setPackageTypeModule,
  toEsmCommand,
} from './esm-config';
import { findDecoratedCycleUses } from './esm-import-cycles';
import { addJsExtensions } from './esm-specifiers';
import { moveDecoratedTypesToTypeImports } from './esm-type-imports';
import { LEGACY_VENDOR_TS_COMPILER } from './heal-vendor-migrate-store';

/**
 * Converts a nest-server 12 API project from CommonJS to an ES module project, the steps of the
 * nest-server migration guide 11.43.x → 12.0.x, §17, in its order. Exact rewrites are applied;
 * what has no exact rewrite is returned as a finding with file and line (the user's decision:
 * detect and report, never guess). The caller verifies the result by building and starting it
 * (`esm-verify.ts`), because the two traps the guide names, a named import Node cannot see and
 * an import cycle under a decorator, pass the test suite.
 */

export interface EsmConversionOptions {
  /**
   * Run the checks that need a type-checked program and installed dependencies: TS1272, import
   * cycles, named imports. Default true. The vendor conversion of an ESM starter passes false:
   * it runs before `pnpm install`, and the starter itself is valid ESM already, so only the
   * files the conversion rewrote need the file-level steps.
   */
  analyze?: boolean;
  apiDir: string;
  /** Ask Node which named exports each package offers (imports every package once). */
  checkNamedImports: boolean;
  dryRun: boolean;
  mode: 'npm' | 'vendor';
}

export interface EsmConversionResult {
  changes: string[];
  findings: EsmFinding[];
}

export interface EsmFinding {
  file: string;
  line?: number;
  message: string;
}

/** Source directories of a lt API project that hold the project's own TypeScript. */
const SOURCE_DIRS = ['src', 'tests', 'test', 'migrations', 'migrations-utils', 'scripts'];
const SKIP_DIRS = new Set(['.git', '.nuxt', '.output', 'coverage', 'dist', 'node_modules']);

/** What makes a vendored CommonJS store depend on the CommonJS bootstrap the conversion removes. */
const VENDOR_STORE_MARKER = "require('./ts-compiler')";

/**
 * The store of an ES module vendor project. Its default export is what the migrate CLI reads,
 * as in the ESM starter (`export default createMigrationStore(…)`), but the helper comes in
 * through `createRequire`, not `import`: the migrate CLI loads this file with `require()`, and
 * `require(esm)` does not run the loader's ESM hooks, so an `import` of the vendored TypeScript
 * fails with `Cannot find module …/src/core/index.js` (measured 2026-10-26). The loader's
 * require hook does compile it. In the production image the same `require` loads the compiled
 * helper, an ES module, through Node's `require(esm)`.
 */
export const VENDOR_ESM_STORE = [
  '// Migration store. Loaded by the migrate CLI via `--store`; it reads the default export.',
  '//',
  '// The helper is required, not imported: the migrate CLI loads this file with require(), which',
  "// skips the loader's ESM hooks but runs its require hook, so the vendored TypeScript compiles",
  '// (`--compiler ts:./src/core/modules/migrate/helpers/ts-compiler.js`). The production image',
  '// requires the compiled helper.',
  "import { createRequire } from 'node:module';",
  '',
  "import { resolveMongoUri } from './mongo-uri.js';",
  '',
  'const require = createRequire(import.meta.url);',
  "const { createMigrationStore } = require('../src/core/modules/migrate/migration.helper');",
  '',
  'export default createMigrationStore(',
  '  resolveMongoUri(),',
  "  'migrations', // optional, default is 'migrations'",
  ');',
  '',
].join('\n');

export function convertProjectToEsm(options: EsmConversionOptions): EsmConversionResult {
  const { apiDir, dryRun, mode } = options;
  const changes: string[] = [];
  const findings: EsmFinding[] = [];
  const rel = (file: string) => relative(apiDir, file) || basename(file);
  const loader = mode === 'vendor' ? VENDOR_CORE_LOADER : NPM_CORE_LOADER;
  // Every write waits until all in-memory rewrites succeeded: a rewrite that throws must not leave
  // a project with "type": "module" and nodenext configs over unconverted sources, which builds
  // neither way (it happened on a real project, review 2026-10-26).
  const pending: (() => void)[] = [];
  const write = (file: string, text: string, what: string) => {
    changes.push(`${rel(file)}: ${what}`);
    pending.push(() => writeFileSync(file, text));
  };

  // ── 1. package.json: "type": "module", dev start and scripts through the framework loader ──
  const pkgPath = join(apiDir, 'package.json');
  let pkgText = readFileSync(pkgPath, 'utf8');
  const typed = setPackageTypeModule(pkgText);
  if (typed) {
    pkgText = typed;
    changes.push('package.json: "type": "module"');
  }
  const { applyEdits, modify } = require('jsonc-parser') as typeof import('jsonc-parser');
  const scripts = (JSON.parse(pkgText).scripts ?? {}) as Record<string, string>;
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue;
    const converted = toEsmCommand(command, loader);
    // A vendored CommonJS project migrates through `migrations-utils/ts-compiler.js`, a CommonJS
    // file that an ES module project would load as ESM. Its job is the ts-node fallback for an
    // 11.x core; an ESM project has a 12 core, whose loader is CommonJS in every project.
    const rewritten = converted.command.replace(/\.\/migrations-utils\/ts-compiler\.js/g, loader);
    if (rewritten !== command) {
      pkgText = applyEdits(
        pkgText,
        modify(pkgText, ['scripts', name], rewritten, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
      );
      changes.push(`package.json: scripts.${name}`);
    }
    for (const unconverted of converted.unconverted) {
      findings.push({
        file: 'package.json',
        message: `scripts.${name} still runs ts-node with an option node lacks: ${unconverted}`,
      });
    }
  }
  if (pkgText !== readFileSync(pkgPath, 'utf8')) pending.push(() => writeFileSync(pkgPath, pkgText));

  // ── 2. nodemon configs ──
  for (const config of ['nodemon.json', 'nodemon-debug.json']) {
    const file = join(apiDir, config);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    const exec = JSON.parse(raw).exec;
    if (typeof exec !== 'string') continue;
    const result = toEsmCommand(exec, loader);
    if (result.command !== exec)
      write(
        file,
        raw.replace(JSON.stringify(exec), JSON.stringify(result.command)),
        'exec through the framework loader',
      );
    for (const unconverted of result.unconverted) {
      findings.push({ file: config, message: `exec still runs ts-node with an option node lacks: ${unconverted}` });
    }
  }

  // ── 3. tsconfigs: nodenext, isolatedModules ──
  for (const entry of readdirSync(apiDir)) {
    if (!/^tsconfig.*\.json$/.test(entry)) continue;
    const file = join(apiDir, entry);
    const next = convertTsconfigToNodeNext(readFileSync(file, 'utf8'), entry === 'tsconfig.json');
    if (next)
      write(file, next, `module/moduleResolution nodenext${entry === 'tsconfig.json' ? ', isolatedModules' : ''}`);
    const paths = (require('jsonc-parser') as typeof import('jsonc-parser')).parse(next ?? readFileSync(file, 'utf8'))
      ?.compilerOptions?.paths;
    if (paths && Object.keys(paths).length > 0) {
      findings.push({
        file: entry,
        message:
          'compilerOptions.paths: Node resolves no path aliases in an ES module; use relative imports or package.json "imports"',
      });
    }
  }

  // ── 4. TypeScript sources: CommonJS syntax, then specifiers ──
  const sources = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const coreDir = join(apiDir, 'src', 'core');
  const isOwnFile = (file: string) => !(mode === 'vendor' && (file === coreDir || file.startsWith(`${coreDir}/`)));
  for (const file of collectFiles(apiDir, /\.(?:[cm]?ts)$/, isOwnFile)) {
    if (file.endsWith('.d.ts')) continue;
    const sourceFile = sources.addSourceFileAtPath(file);
    const syntax = convertCommonJsSyntax(sourceFile);
    const specifiers = addJsExtensions(sourceFile, existsSync);
    if (syntax.changed.length + specifiers.changed.length > 0) {
      changes.push(`${rel(file)}: ${syntax.changed.length + specifiers.changed.length} import/syntax change(s)`);
    }
    for (const finding of syntax.reported)
      findings.push({ file: rel(file), line: finding.line, message: `${finding.why}: ${finding.text}` });
    for (const unresolved of specifiers.unresolved) {
      findings.push({
        file: rel(file),
        line: unresolved.line,
        message: `relative import resolves to no file: '${unresolved.specifier}'`,
      });
    }
  }

  // ── 5. migrations-utils/*.js: ES modules ──
  const utilsDir = join(apiDir, 'migrations-utils');
  const handled = new Set<string>();
  if (mode === 'vendor' && existsSync(utilsDir)) {
    // The store and bootstrap lt wrote into a vendored CommonJS project are replaced only when
    // they are byte for byte what lt wrote. A project's own store (its own URI logic, its own
    // helper resolution) is never overwritten: the replacement would drop that logic, and it
    // imports a `mongo-uri.js` such a project may not have (CLAUDE.md, "A destructive self-heal
    // must prove the hazard").
    const storeFile = join(utilsDir, 'migrate.js');
    const bootstrapFile = join(utilsDir, 'ts-compiler.js');
    const store = existsSync(storeFile) ? readFileSync(storeFile, 'utf8') : undefined;
    const bootstrap = existsSync(bootstrapFile) ? readFileSync(bootstrapFile, 'utf8') : undefined;
    const storeIsLt = store !== undefined && isLtVendorFile(store, 'migrate-store.js');
    const storeNeedsBootstrap = store?.includes(VENDOR_STORE_MARKER) ?? false;

    if (storeIsLt && existsSync(join(utilsDir, 'mongo-uri.js'))) {
      write(storeFile, VENDOR_ESM_STORE, 'migration store as ES module (vendored core)');
      handled.add('migrate.js');
    } else if (storeNeedsBootstrap) {
      handled.add('migrate.js');
      findings.push({
        file: rel(storeFile),
        message:
          "not the store lt generated, and it loads './ts-compiler', a CommonJS bootstrap an ES module cannot load. " +
          "Convert it by hand: load the helper with createRequire(import.meta.url) and require('../src/core/modules/migrate/migration.helper'), " +
          'export the store as default, then delete migrations-utils/ts-compiler.js',
      });
    }
    if (bootstrap !== undefined) {
      handled.add('ts-compiler.js');
      if (isLtVendorFile(bootstrap, 'ts-compiler.js') && !(storeNeedsBootstrap && !storeIsLt)) {
        changes.push(`${rel(bootstrapFile)}: removed (the 12 core's loader is used directly)`);
        pending.push(() => unlinkSync(bootstrapFile));
      } else if (!storeNeedsBootstrap || storeIsLt) {
        findings.push({
          file: rel(bootstrapFile),
          message:
            "not lt's generated bootstrap, and CommonJS in an ES module project. The scripts now name the core loader: " +
            'delete it, or rename it to .cjs if something else still loads it',
        });
      }
    }
  }
  if (existsSync(utilsDir)) {
    for (const entry of readdirSync(utilsDir)) {
      if (!entry.endsWith('.js') || handled.has(entry)) continue;
      const file = join(utilsDir, entry);
      const sourceFile = sources.addSourceFileAtPath(file);
      const result = convertCommonJsModule(sourceFile, existsSync);
      if (result.changed) changes.push(`${rel(file)}: CommonJS → ES module`);
      for (const finding of result.reported) {
        findings.push({
          file: rel(file),
          line: finding.line,
          message: `CommonJS export, convert by hand: ${finding.text}`,
        });
      }
    }
  }

  // ── 6. vitest configs: resolve like Node ──
  for (const entry of readdirSync(apiDir)) {
    if (!/^vite(?:st)?(?:-[\w-]+)?\.config\.[cm]?ts$/.test(entry)) continue;
    const sourceFile = sources.getSourceFile(join(apiDir, entry)) ?? sources.addSourceFileAtPath(join(apiDir, entry));
    const state = ensureVitestNodeResolution(sourceFile);
    if (state === 'added') changes.push(`${entry}: resolve.extensions (graphql loads once)`);
    if (state === 'unrecognised') {
      findings.push({
        file: entry,
        message: 'add resolve.extensions [.js first] by hand: the config has no defineConfig({ … }) literal',
      });
    }
  }

  if (dryRun) return { changes, findings };
  for (const apply of pending) apply();
  sources.saveSync();
  if (options.analyze === false) return { changes, findings };
  // The type-checked project below needs about 2 GB on a project of turbo's size. Holding the
  // rewrite project's node wrappers next to it took the run to 3.8 of Node's 4.5 GB default heap.
  for (const file of sources.getSourceFiles()) sources.removeSourceFile(file);

  // ── 7. TS1272 under the new settings, then what has no exact rewrite ──
  const typed1272 = new Project({ tsConfigFilePath: join(apiDir, 'tsconfig.json') });
  for (const fix of moveDecoratedTypesToTypeImports(typed1272)) {
    changes.push(`${rel(fix.file)}: import type { ${fix.names.join(', ')} } (decorated signature)`);
  }
  typed1272.saveSync();

  // The files the rewrites covered: the project's own TypeScript and its migrations-utils.
  // Anything else under allowJs (a k6 script, a tool config) never runs as part of the app.
  const ownSource = (file: SourceFile) => {
    const path = file.getFilePath();
    if (
      !path.startsWith(`${apiDir}/`) ||
      path.includes('/node_modules/') ||
      path.includes('/dist/') ||
      !isOwnFile(path)
    ) {
      return false;
    }
    return /\.[cm]?ts$/.test(path) || path.startsWith(`${utilsDir}/`);
  };
  for (const cycle of findDecoratedCycleUses(typed1272, ownSource)) {
    findings.push({
      file: rel(cycle.file),
      line: cycle.line,
      message:
        `${cycle.text} — ${cycle.className} is on an import cycle (${cycle.cycle.map(rel).join(' ↔ ')}); ` +
        `ESM throws "Cannot access '${cycle.className}' before initialization". Type it as WrapperType<${cycle.className}>`,
    });
  }
  if (options.checkNamedImports) {
    const requests = collectEmittedNamedImports(typed1272, ownSource);
    for (const finding of checkNamedImportsAgainstNode(apiDir, requests)) {
      findings.push({ file: rel(finding.file), line: finding.line, message: `${finding.specifier}: ${finding.why}` });
    }
  }
  return { changes, findings };
}

/**
 * True when `content` is exactly a file lt wrote into a vendored CommonJS project: the current
 * template from `templates/vendor-scripts/`, or, for the bootstrap, the one version earlier CLIs
 * generated. Line endings do not count (a Windows checkout).
 */
export function isLtVendorFile(content: string, template: 'migrate-store.js' | 'ts-compiler.js'): boolean {
  const normalise = (text: string) => text.replace(/\r\n/g, '\n');
  const candidates = [readFileSync(join(__dirname, '..', 'templates', 'vendor-scripts', template), 'utf8')];
  if (template === 'ts-compiler.js') candidates.push(LEGACY_VENDOR_TS_COMPILER);
  return candidates.some((candidate) => normalise(candidate) === normalise(content));
}

/** Files under the project's source directories and its root, matching `pattern`. */
function collectFiles(apiDir: string, pattern: RegExp, include: (file: string) => boolean): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!include(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (pattern.test(entry) && include(path)) files.push(path);
    }
  };
  for (const dir of SOURCE_DIRS) {
    if (existsSync(join(apiDir, dir))) walk(join(apiDir, dir));
  }
  for (const entry of readdirSync(apiDir)) {
    const path = join(apiDir, entry);
    if (pattern.test(entry) && statSync(path).isFile()) files.push(path);
  }
  return files.sort();
}
