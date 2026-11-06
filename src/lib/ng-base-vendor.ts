/**
 * Vendor mode for Angular apps: `@lenne.tech/ng-base` copied into the app.
 *
 * The Angular counterpart of the nuxt-extensions vendoring in
 * `extensions/frontend-helper.ts`, with one structural difference: no import is
 * rewritten. The library's source lands in `<app>/src/core/`, and the app's
 * `tsconfig.json` maps the package specifiers onto it, one entry per entry point:
 *
 *   `@lenne.tech/ng-base`      → `./src/core/src/public-api.ts`
 *   `@lenne.tech/ng-base/auth` → `./src/core/auth/src/public-api.ts`
 *
 * So `import { LtAuthService } from '@lenne.tech/ng-base/auth'` reads the same in
 * both modes, the library's own cross-entry imports keep working, and the way
 * back to npm is "remove the mapping, restore the dependency".
 *
 * Layout contract with ng-base (plan.md §5.6, revised 2026-11-06): the library
 * lives in `projects/ng-base/` of the ng-base repo in the `ng g library` layout.
 * Every entry point is a directory with an `ng-package.json`: the library root for
 * `@lenne.tech/ng-base`, `<entry>/` for `@lenne.tech/ng-base/<entry>`, each pointing
 * at its source through `lib.entryFile` (default `src/public-api.ts`). The mapping
 * is DERIVED from those files, never assumed, and the copy keeps them so it stays
 * derivable. Release tags carry a `v` (`v22.0.0`).
 */

import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { formatMarkdownTable } from './markdown-table';

export const NG_BASE_PACKAGE = '@lenne.tech/ng-base';
export const NG_BASE_REPO_URL = 'https://github.com/lenneTech/ng-base.git';
/** The vendored library, relative to the app. */
export const NG_BASE_CORE_DIR = join('src', 'core');
/** Where the library lives inside the ng-base repository. */
export const NG_BASE_LIBRARY_DIR = join('projects', 'ng-base');

/**
 * ng-packagr's own default when an `ng-package.json` names no `lib.entryFile` (its schema
 * says `src/public_api.ts`, with an underscore; `ng g library` writes the file as
 * `src/public-api.ts` and therefore always names it explicitly).
 */
export const NG_BASE_DEFAULT_ENTRY_FILE = 'src/public_api.ts';

/**
 * Library files that only build or test the package, or that address the people and
 * agents working ON the library. Compiled as app source, the first would fail the app's
 * own checks (specs need the library's test setup, the library tsconfigs point at paths
 * that do not exist in the app); a `CLAUDE.md` / `AGENTS.md` inside the app's `src/core/`
 * would hand every agent in the app the library's development rules. `ng-package.json`
 * stays: it is what the tsconfig mapping is derived from.
 */
const EXCLUDED_FILE =
  /(^package\.json$|^tsconfig.*\.json$|\.spec\.ts$|^test-setup\.ts$|^karma\.conf|^vitest\.config|^README\.md$|^CLAUDE\.md$|^AGENTS\.md$)/;
const EXCLUDED_DIR = new Set(['.claude', 'dist', 'node_modules']);

/** The `@import` of an ng-base stylesheet, npm form (`'@lenne.tech/ng-base/ui/styles/theme.css'`). */
const NPM_STYLE_IMPORT = /(@import\s+(?:url\(\s*)?)(['"])@lenne\.tech\/ng-base\//g;

/**
 * Points `@lenne.tech/ng-base` at a LOCAL build in npm mode, for testing unreleased
 * ng-base work: `file:<dist>` plus `dependenciesMeta.injected`. Injected, never linked:
 * a linked dist resolves `@angular/core` from the ng-base checkout's own node_modules, so
 * two Angular copies run and every SSR render fails with NG0203 (found by the
 * ng-base-starter session, 2026-11-06). pnpm copies an injected dependency into the
 * app's virtual store, so it resolves the app's Angular; rerun `pnpm install` after
 * every ng-base build. Mutates `pkg`.
 */
export function applyLocalNgBaseDependency(pkg: Record<string, any>, distDir: string): void {
  delete pkg.devDependencies?.[NG_BASE_PACKAGE];
  pkg.dependencies = sortKeys({ ...(pkg.dependencies || {}), [NG_BASE_PACKAGE]: `file:${distDir}` });
  const meta = pkg.dependenciesMeta && typeof pkg.dependenciesMeta === 'object' ? pkg.dependenciesMeta : {};
  pkg.dependenciesMeta = { ...meta, [NG_BASE_PACKAGE]: { ...(meta[NG_BASE_PACKAGE] || {}), injected: true } };
}

/**
 * The dependency changes vendor mode needs: the package itself goes, and its peers
 * become the app's own dependencies. In npm mode pnpm installs a package's peers on
 * its own (`autoInstallPeers`), so a starter need not list them; the vendored source
 * imports them directly, and the app's typecheck covers every entry point, including
 * the optional ones (`tus-js-client` for `/files`).
 *
 * Only ADDS what the app does not declare yet, with the peer range as written. A peer
 * the library lists as optional for test tooling (`@playwright/test`) goes to
 * devDependencies.
 *
 * Mutates `pkg`. @returns the names it added.
 */
export function applyVendorDependencies(
  pkg: Record<string, any>,
  library: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> },
): string[] {
  const added: string[] = [];
  delete pkg.dependencies?.[NG_BASE_PACKAGE];
  delete pkg.devDependencies?.[NG_BASE_PACKAGE];
  // A local injected build (`applyLocalNgBaseDependency`, or a starter in development) leaves
  // `dependenciesMeta` behind; for a package that is no dependency any more it means nothing.
  if (pkg.dependenciesMeta && typeof pkg.dependenciesMeta === 'object') {
    delete pkg.dependenciesMeta[NG_BASE_PACKAGE];
    if (Object.keys(pkg.dependenciesMeta).length === 0) {
      delete pkg.dependenciesMeta;
    }
  }
  pkg.dependencies = pkg.dependencies || {};
  const declared = (name: string): boolean => name in (pkg.dependencies || {}) || name in (pkg.devDependencies || {});
  const wanted = { ...(library.dependencies || {}), ...(library.peerDependencies || {}) };
  for (const [name, range] of Object.entries(wanted)) {
    if (name === NG_BASE_PACKAGE || declared(name)) {
      continue;
    }
    if (name === '@playwright/test') {
      pkg.devDependencies = pkg.devDependencies || {};
      pkg.devDependencies[name] = range;
    } else {
      pkg.dependencies[name] = range;
    }
    added.push(name);
  }
  pkg.dependencies = sortKeys(pkg.dependencies);
  if (pkg.devDependencies) {
    pkg.devDependencies = sortKeys(pkg.devDependencies);
  }
  return added;
}

/** The VENDOR.md a fresh vendor conversion writes into `src/core/`. */
export function buildNgBaseVendorMd(options: {
  commit?: string;
  date: string;
  source: string;
  version?: string;
}): string {
  const { commit, date, source, version } = options;
  const lines = [
    `# ${NG_BASE_PACKAGE} (vendored)`,
    '',
    `This directory is a curated vendor copy of \`${NG_BASE_PACKAGE}\`. It is first-class`,
    'project code, not a node_modules shadow copy, but it is **not a fork**. The copy exists',
    'so Claude Code (and humans) can read the framework internals directly. Log substantial',
    'local changes in the "Local changes" table below so the `ng-base-core-updater` agent can',
    'classify them at sync time.',
    '',
    'No import is rewritten: `tsconfig.json` maps `@lenne.tech/ng-base` and every',
    '`@lenne.tech/ng-base/<entry>` onto this directory, one entry per `ng-package.json`',
    '(its `lib.entryFile`), so project code imports the package specifiers in both modes.',
    'Keep the `ng-package.json` files: a sync re-derives the mapping from them.',
    '',
    '## Modification Policy',
    '',
    'Edit `src/core/` **only** when the change is generally useful to every',
    `${NG_BASE_PACKAGE} consumer:`,
    '',
    '- Bugfixes that apply to every consumer',
    '- Broad framework enhancements (new services, better defaults, SSR fixes)',
    '- Security vulnerability fixes',
    '- Type/config compatibility fixes every consumer would hit',
    '',
    'Everything else stays **outside** `src/core/`. Project-specific business rules,',
    'customer branding and proprietary integrations belong in project code (`src/app/`).',
    '',
    'Generally-useful changes **MUST** go upstream as a PR to',
    'https://github.com/lenneTech/ng-base. Run `/lt-dev:frontend:contribute-ng-base-core`',
    'to prepare it; `/lt-dev:frontend:update-ng-base-core` syncs this directory from upstream.',
    'When in doubt, ask before editing `src/core/`.',
    '',
    '## Baseline',
    '',
    '- **Upstream-Repo:** https://github.com/lenneTech/ng-base',
    `- **Baseline-Version:** ${version || '(not detected)'}`,
    `- **Baseline-Commit:** ${commit ? `\`${commit}\`` : '(not detected)'}`,
    `- **Vendored am:** ${date}`,
    `- **Vendored von:** lt CLI (${source})`,
    '',
    '## Sync history',
    '',
    ...formatMarkdownTable(
      ['Date', 'From', 'To', 'Notes'],
      [[date, '—', version || 'initial import', 'scaffolded by lt CLI']],
    ),
    '',
    '## Local changes',
    '',
    ...formatMarkdownTable(
      ['Date', 'Commit', 'Scope', 'Reason', 'Status'],
      [['—', '—', '(none, pristine)', 'initial vendor', '—']],
    ),
  ];
  return lines.join('\n');
}

/**
 * Copies the library source from `libraryDir` to `coreDir`, without the files that
 * only build or test the package (see {@link EXCLUDED_FILE}). Never follows a
 * symlink inside the source: a link there is copied as nothing, so a planted link
 * cannot pull a file from elsewhere on disk into the project.
 *
 * @returns the number of files copied.
 */
export function copyNgBaseSource(libraryDir: string, coreDir: string): number {
  let copied = 0;
  const walk = (from: string, to: string): void => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      const target = join(to, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIR.has(entry.name)) {
          walk(source, target);
        }
        continue;
      }
      if (entry.isFile() && !EXCLUDED_FILE.test(entry.name)) {
        cpSync(source, target);
        copied++;
      }
    }
  };
  walk(libraryDir, coreDir);
  return copied;
}

/** True when the app in `appDir` carries a vendored ng-base (`src/core/VENDOR.md` naming the package). */
export function isVendoredNgBaseProject(appDir: string): boolean {
  const vendorMd = join(appDir, NG_BASE_CORE_DIR, 'VENDOR.md');
  if (!existsSync(vendorMd)) {
    return false;
  }
  try {
    return readFileSync(vendorMd, 'utf8').includes(NG_BASE_PACKAGE);
  } catch {
    return false;
  }
}

/**
 * The secondary entry points of a vendored or source library (`auth`, `ui`, …): every
 * directory below it with an `ng-package.json`, the library root excluded.
 */
export function ngBaseEntryPoints(libraryDir: string): string[] {
  return Object.keys(ngBaseTsconfigPaths(libraryDir, '.'))
    .filter((key) => key !== NG_BASE_PACKAGE)
    .map((key) => key.slice(NG_BASE_PACKAGE.length + 1))
    .sort();
}

/** The release tag of an ng-base version. ng-base tags carry a `v`, unlike nuxt-extensions. */
export function ngBaseTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

/**
 * The tsconfig `paths` for a library tree: one key per `ng-package.json` found below
 * `libraryDir` (the root one maps `@lenne.tech/ng-base`, `<entry>/ng-package.json` maps
 * `@lenne.tech/ng-base/<entry>`), each pointing at that entry's `lib.entryFile`
 * relative to `prefix` (`./src/core` for a vendored app). An entry whose entry file
 * does not exist, or would point outside its directory, is left out: a mapping onto
 * nothing turns every import of it into a confusing TS2307.
 *
 * Never follows a symlink, and skips `node_modules` / `dist`.
 */
export function ngBaseTsconfigPaths(libraryDir: string, prefix = './src/core'): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  const walk = (dir: string, rel: string[]): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === 'ng-package.json')) {
      const entryFile = readEntryFile(join(dir, 'ng-package.json'));
      if (entryFile && existsSync(join(dir, entryFile))) {
        const key = rel.length === 0 ? NG_BASE_PACKAGE : `${NG_BASE_PACKAGE}/${rel.join('/')}`;
        paths[key] = [[prefix, ...rel, entryFile].join('/')];
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !EXCLUDED_DIR.has(entry.name)) {
        walk(join(dir, entry.name), [...rel, entry.name]);
      }
    }
  };
  walk(libraryDir, []);
  return paths;
}

/**
 * The ng-base version the app pins, without range operators (`^22.0.0` → `22.0.0`),
 * or `undefined` when it declares none or a spec that is not a version (`workspace:*`,
 * a `file:` link).
 */
export function pinnedNgBaseVersion(pkg: Record<string, any> | undefined): string | undefined {
  const spec = pkg?.dependencies?.[NG_BASE_PACKAGE] ?? pkg?.devDependencies?.[NG_BASE_PACKAGE];
  if (typeof spec !== 'string') {
    return undefined;
  }
  const match = /^[\^~=v\s]*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(spec.trim());
  return match ? match[1] : undefined;
}

/** Removes the vendored library. Refuses a `src/core` that is a symlink (it would point at someone's checkout). */
export function removeVendoredNgBase(appDir: string): boolean {
  const coreDir = join(appDir, NG_BASE_CORE_DIR);
  if (!existsSync(coreDir) || lstatSync(coreDir).isSymbolicLink()) {
    return false;
  }
  rmSync(coreDir, { force: true, recursive: true });
  return true;
}

/**
 * The build of a local ng-base checkout (`--frontend-framework-copy` in npm mode): the
 * `dest` of its root `ng-package.json` (ng-packagr's output, `../../dist/ng-base` in
 * the `ng g library` layout), which must hold a built `package.json` named
 * `@lenne.tech/ng-base`. `error` says what is missing, so a command can refuse before
 * it changes anything.
 */
export function resolveLocalNgBaseBuild(source: string): { distDir?: string; error?: string } {
  const libraryDir = resolveNgBaseLibraryDir(source);
  if (!libraryDir) {
    return {
      error: `${source} is no ng-base checkout (no projects/ng-base/ng-package.json with an existing entry file).`,
    };
  }
  let dest = '../../dist/ng-base';
  try {
    const { parse } = require('jsonc-parser') as typeof import('jsonc-parser');
    const value = (parse(readFileSync(join(libraryDir, 'ng-package.json'), 'utf8')) as any)?.dest;
    if (typeof value === 'string' && value) {
      dest = value;
    }
  } catch {
    // Unreadable: keep the ng g library default.
  }
  const distDir = resolve(libraryDir, dest);
  try {
    const built = JSON.parse(readFileSync(join(distDir, 'package.json'), 'utf8'));
    if (built?.name === NG_BASE_PACKAGE) {
      return { distDir };
    }
  } catch {
    // Falls through to the error below.
  }
  return {
    error: `No ng-base build at ${join(distDir, 'package.json')}. Build the library in the ng-base checkout first (and run pnpm install in the app again after every rebuild).`,
  };
}

/**
 * Resolves a local ng-base source (`--frontend-framework-copy`) to the library
 * directory. Accepts the repository root (holding `projects/ng-base/`) or the
 * library directory itself. Symlinks are resolved first, so a linked checkout is
 * read, never replaced.
 *
 * @returns the library directory, or `undefined` when `source` is neither.
 */
export function resolveNgBaseLibraryDir(source: string): string | undefined {
  if (!existsSync(source)) {
    return undefined;
  }
  const real = realpathSync(source);
  for (const candidate of [join(real, NG_BASE_LIBRARY_DIR), real]) {
    if (NG_BASE_PACKAGE in ngBaseTsconfigPaths(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Rewrites ng-base stylesheet imports in the app's stylesheets between the package
 * specifier (`npm`) and the vendored path (`vendor`, relative to each stylesheet:
 * `./core/ui/styles/theme.css` from `src/styles.css`). Needed because the tsconfig
 * `paths` reach only TypeScript: `@tailwindcss/postcss` resolves `@import` itself,
 * from `node_modules` only, so a vendored app whose `styles.css` still names the
 * package fails `ng build` with "Could not resolve '@lenne.tech/ng-base/ui/…'".
 *
 * Stylesheets are every `styles` entry of every target in `angular.json` plus
 * `src/styles.css`; one that is a symlink or lies outside the app is skipped.
 *
 * @returns the app-relative paths of the stylesheets it changed.
 */
export function rewriteNgBaseStyleImports(appDir: string, mode: 'npm' | 'vendor'): string[] {
  const appRoot = realpathSync(appDir);
  const coreDir = join(appRoot, NG_BASE_CORE_DIR);
  const changed: string[] = [];
  for (const rel of appStylesheets(appRoot)) {
    const file = resolve(appRoot, rel);
    if (!file.startsWith(appRoot + sep) || !existsSync(file) || lstatSync(file).isSymbolicLink()) {
      continue;
    }
    let toCore = relative(dirname(file), coreDir).split(sep).join('/');
    if (!toCore.startsWith('.')) {
      toCore = `./${toCore}`;
    }
    const original = readFileSync(file, 'utf8');
    const vendored = new RegExp(
      `(@import\\s+(?:url\\(\\s*)?)(['"])${toCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`,
      'g',
    );
    const next =
      mode === 'vendor'
        ? original.replace(NPM_STYLE_IMPORT, `$1$2${toCore}/`)
        : original.replace(vendored, `$1$2${NG_BASE_PACKAGE}/`);
    if (next !== original) {
      writeFileSync(file, next);
      changed.push(relative(appRoot, file).split(sep).join('/'));
    }
  }
  return changed;
}

/**
 * Sets (`vendor`) or removes (`npm`) the ng-base `compilerOptions.paths` entries in
 * the app's `tsconfig.json`, keeping its comments and formatting (it is JSONC).
 *
 * `vendor` writes exactly the mapping {@link ngBaseTsconfigPaths} derives from the
 * vendored `src/core/` and drops ng-base keys it no longer derives (an entry point
 * that went away). `npm` removes `@lenne.tech/ng-base` and every
 * `@lenne.tech/ng-base/…` key, whatever entry points existed. Other `paths` entries
 * are never touched, and an emptied `paths` object is removed only when ng-base had
 * been its only content.
 *
 * @returns `changed` when the file was written, `missing` when there is no
 *          tsconfig.json, `unparseable` when it cannot be edited safely,
 *          `no-entries` when the vendored tree has no usable `ng-package.json`.
 */
export function setNgBaseTsconfigPaths(
  appDir: string,
  mode: 'npm' | 'vendor',
): 'changed' | 'missing' | 'no-entries' | 'unchanged' | 'unparseable' {
  const file = join(appDir, 'tsconfig.json');
  if (!existsSync(file) || lstatSync(file).isSymbolicLink()) {
    return 'missing';
  }
  // Lazy: gluegun loads every command module on every `lt` run.
  const { applyEdits, modify, parse } = require('jsonc-parser') as typeof import('jsonc-parser');
  const original = readFileSync(file, 'utf8');
  const errors: import('jsonc-parser').ParseError[] = [];
  const config = parse(original, errors, { allowTrailingComma: true }) as Record<string, any> | undefined;
  if (errors.length > 0 || !config || typeof config !== 'object') {
    return 'unparseable';
  }

  const formattingOptions = { eol: original.includes('\r\n') ? '\r\n' : '\n', insertSpaces: true, tabSize: 2 };
  const desired = mode === 'vendor' ? ngBaseTsconfigPaths(join(appDir, NG_BASE_CORE_DIR)) : {};
  if (mode === 'vendor' && Object.keys(desired).length === 0) {
    return 'no-entries';
  }
  const isNgBaseKey = (key: string): boolean => key === NG_BASE_PACKAGE || key.startsWith(`${NG_BASE_PACKAGE}/`);
  const existing: Record<string, unknown> =
    config.compilerOptions?.paths && typeof config.compilerOptions.paths === 'object'
      ? config.compilerOptions.paths
      : {};
  let text = original;
  for (const key of Object.keys(existing)) {
    if (isNgBaseKey(key) && !(key in desired)) {
      text = applyEdits(text, modify(text, ['compilerOptions', 'paths', key], undefined, { formattingOptions }));
    }
  }
  for (const [key, value] of Object.entries(desired)) {
    if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
      text = applyEdits(text, modify(text, ['compilerOptions', 'paths', key], value, { formattingOptions }));
    }
  }
  const remaining = Object.keys(existing).filter((key) => !isNgBaseKey(key));
  if (mode === 'npm' && remaining.length === 0 && text !== original) {
    text = applyEdits(text, modify(text, ['compilerOptions', 'paths'], undefined, { formattingOptions }));
  }

  if (text === original) {
    return 'unchanged';
  }
  writeFileSync(file, text);
  return 'changed';
}

/** Reads the Baseline-Version a VENDOR.md records. */
export function vendoredNgBaseVersion(appDir: string): string | undefined {
  try {
    const content = readFileSync(join(appDir, NG_BASE_CORE_DIR, 'VENDOR.md'), 'utf8');
    return /Baseline-Version[^0-9]*(\d+\.\d+\.\d+\S*)/.exec(content)?.[1];
  } catch {
    return undefined;
  }
}

/** The `check:vendor-freshness` one-liner for a vendored core: baseline in VENDOR.md vs. npm `latest`. */
export function vendorFreshnessScript(vendorMdPath: string, packageName: string): string {
  return [
    'node -e "',
    "var f=require('fs'),h=require('https');",
    `try{var c=f.readFileSync('${vendorMdPath}','utf8')}catch(e){process.exit(0)}`,
    'var m=c.match(/Baseline-Version[^0-9]*(\\d+\\.\\d+\\.\\d+)/);',
    "if(!m){process.stderr.write(String.fromCharCode(9888)+' vendor-freshness: no baseline\\n');process.exit(0)}",
    'var v=m[1];',
    `h.get('https://registry.npmjs.org/${packageName}/latest',function(r){`,
    "var d='';r.on('data',function(c){d+=c});r.on('end',function(){",
    'try{var l=JSON.parse(d).version;',
    "if(v===l)console.log('vendor core up-to-date (v'+v+')');",
    "else process.stderr.write('vendor core v'+v+', latest v'+l+'\\n')",
    "}catch(e){}})}).on('error',function(){});",
    'setTimeout(function(){process.exit(0)},5000)',
    '"',
  ].join('');
}

/** `styles` of every target in `angular.json` (string or `{ input }`), plus `src/styles.css`. */
function appStylesheets(appDir: string): string[] {
  const files = new Set<string>(['src/styles.css']);
  try {
    const { parse } = require('jsonc-parser') as typeof import('jsonc-parser');
    const workspace = parse(readFileSync(join(appDir, 'angular.json'), 'utf8')) as any;
    for (const project of Object.values<any>(workspace?.projects || {})) {
      for (const target of Object.values<any>(project?.architect || project?.targets || {})) {
        for (const style of [
          target?.options?.styles,
          ...Object.values<any>(target?.configurations || {}).map((c) => c?.styles),
        ]) {
          for (const entry of Array.isArray(style) ? style : []) {
            const input = typeof entry === 'string' ? entry : entry?.input;
            if (typeof input === 'string' && /\.(css|scss|sass|less)$/.test(input)) {
              files.add(input);
            }
          }
        }
      }
    }
  } catch {
    // No or unreadable angular.json: src/styles.css alone.
  }
  return [...files];
}

/**
 * `lib.entryFile` of an `ng-package.json`, defaulting like ng-packagr. `undefined`
 * for an unreadable file or an entry file that leaves its directory (`..`, absolute).
 */
function readEntryFile(ngPackageJson: string): string | undefined {
  let entryFile: unknown;
  try {
    // Lazy: gluegun loads every command module on every `lt` run.
    const { parse } = require('jsonc-parser') as typeof import('jsonc-parser');
    entryFile = (parse(readFileSync(ngPackageJson, 'utf8')) as any)?.lib?.entryFile ?? NG_BASE_DEFAULT_ENTRY_FILE;
  } catch {
    return undefined;
  }
  if (typeof entryFile !== 'string' || !entryFile) {
    return undefined;
  }
  const normalized = entryFile.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
    return undefined;
  }
  return normalized;
}

function sortKeys(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}
