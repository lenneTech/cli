import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { alignFrameworkPins } from '../lib/align-framework-pins';
import { hookCheckFreshness, unhookCheckFreshness } from '../lib/check-freshness-hooks';
import { agentDocFiles } from '../lib/dev-patches';
import { execArgs } from '../lib/exec-args';
import { isVendoredAppProject } from '../lib/frontend-framework-detection';
import { formatMarkdownTable } from '../lib/markdown-table';
import { fileImportedSpecifiers, isPackageImport, isRelativeCoreImport } from '../lib/module-specifiers';
import {
  applyLocalNgBaseDependency,
  applyVendorDependencies,
  buildNgBaseVendorMd,
  copyNgBaseSource,
  isVendoredNgBaseProject,
  NG_BASE_CORE_DIR,
  NG_BASE_PACKAGE,
  NG_BASE_REPO_URL,
  ngBaseEntryPoints,
  ngBaseTag,
  ngBaseTsconfigPaths,
  pinnedNgBaseVersion,
  removeVendoredNgBase,
  resolveLocalNgBaseBuild,
  resolveNgBaseLibraryDir,
  rewriteNgBaseStyleImports,
  setNgBaseTsconfigPaths,
  vendoredNgBaseVersion,
  vendorFreshnessScript,
} from '../lib/ng-base-vendor';
import { applyScaffoldIdentity } from '../lib/package-name';
import { applyAngularSiteIdentity, applyNuxtSiteIdentity } from '../lib/site-identity';
import { stripVendorSchemaAugmentation } from '../lib/strip-vendor-schema-augmentation';
import {
  buildFrontendVendorBlock,
  FRONTEND_VENDOR_MARKER,
  insertVendorBlockIfMissing,
  removeVendorBlock,
} from '../lib/vendor-claude-md';
import { isMissingCloneRef, pinnedNuxtExtensionsVersion } from '../lib/vendor-upstream-ref';

/**
 * Options for Angular frontend setup
 */
export interface AngularSetupOptions {
  branch?: string;
  copyPath?: string;
  gitLink?: string;
  linkPath?: string;
  localize?: boolean;
  /**
   * npm mode against a LOCAL ng-base build (the `distDir` from `resolveLocalNgBaseBuild`):
   * `@lenne.tech/ng-base` becomes an injected `file:` dependency, applied before any
   * install. For testing unreleased ng-base work without vendoring it.
   */
  localNgBaseBuild?: string;
  /**
   * `name` in the app's package.json, default `app` (the sub-project name of a
   * workspace). A standalone app passes its directory name, because `lt dev` derives the
   * project's slug and URLs from it. Not in link mode.
   */
  packageName?: string;
  /**
   * Name of the new project: becomes `SITE_NAME` (browser title) in `src/app/shared/site.ts`,
   * and the starter's repository link is removed (`applyAngularSiteIdentity`). Not in link mode.
   */
  siteName?: string;
  skipGitInit?: boolean;
  skipHuskyRemoval?: boolean;
  skipInstall?: boolean;
  /**
   * Vendor `@lenne.tech/ng-base` into `src/core/` before the install (standalone
   * `lt frontend angular --framework-mode vendor`). The workspace commands vendor after
   * setup themselves. A failed conversion is reported and the app stays in npm mode.
   */
  vendor?: { localSource?: string };
  /**
   * The app becomes `projects/app` of a fullstack workspace: husky is removed even when
   * `skipHuskyRemoval` is set. The workspace owns git, hooks and the install. The
   * repo-only files (see {@link ANGULAR_STARTER_REPO_ONLY}) and the starter's identity
   * in package.json go in both cases.
   */
  workspace?: boolean;
}

/**
 * Files of the ng-base-starter repository that describe the STARTER, not an app made
 * from it: its release tooling, its migration guides and its own CI (test.yml and the
 * release workflow). The starter is flat (repo root = app), so unlike nuxt-base-starter
 * there is no wrapper to cut away; these are removed one by one instead, from a
 * standalone app as from a workspace app. The list is the contract agreed with
 * ng-base-starter (plan.md §5.6) and is exhaustive.
 */
export const ANGULAR_STARTER_REPO_ONLY = ['.github', 'CHANGELOG.md', 'extras', 'migration-guides'];

/**
 * Result of frontend setup operation
 */
export interface FrontendSetupResult {
  method: 'clone' | 'copy' | 'link' | 'npx';
  path: string;
  success: boolean;
}

/**
 * Options for Nuxt frontend setup
 */
export interface NuxtSetupOptions {
  branch?: string;
  copyPath?: string;
  linkPath?: string;
  /**
   * `name` in the app's package.json, default `app` (the sub-project name of a
   * workspace). A standalone app passes its directory name. Not in link mode.
   */
  packageName?: string;
  /**
   * Name of the new project: becomes `SITE_NAME` (head title, header) in `app/utils/site.ts`,
   * and the starter's repository link is removed (`applyNuxtSiteIdentity`). Not in link mode.
   */
  siteName?: string;
  skipInstall?: boolean;
}

/**
 * Frontend helper functions for project scaffolding
 * Provides reusable methods for setting up Nuxt and Angular frontends
 */
export class FrontendHelper {
  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {}

  /**
   * Sets `name` in package.json: `app` for the sub-project of a workspace, the
   * directory name for a standalone app (`lt dev` derives the slug from it).
   *
   * @param dest - Directory containing the package.json
   * @param name - New package name
   */
  private async fixPackageName(dest: string, name: string): Promise<void> {
    const { patching } = this.toolbox;
    await patching.update(`${dest}/package.json`, (data: Record<string, unknown>) => {
      data.name = name;
      return data;
    });
  }

  /**
   * Patch frontend .env file with project-specific values
   * Replaces template placeholders with actual project values
   *
   * @param dest - Directory containing the .env file
   * @param projectName - Project name in kebab-case (e.g., "my-shop")
   */
  public patchFrontendEnv(dest: string, projectName: string): void {
    const { filesystem } = this.toolbox;
    const envPath = `${dest}/.env`;
    const envExamplePath = `${dest}/.env.example`;

    // Create .env from .env.example if it doesn't exist
    if (!filesystem.exists(envPath) && filesystem.exists(envExamplePath)) {
      filesystem.copy(envExamplePath, envPath);
    }

    if (!filesystem.exists(envPath)) {
      return;
    }

    let content = filesystem.read(envPath);
    if (!content) {
      return;
    }

    // Replace the storage prefix with a project-specific one: NUXT_PUBLIC_STORAGE_PREFIX in a
    // Nuxt app, NG_PUBLIC_STORAGE_PREFIX in an Angular app (ng-base-starter).
    content = content.replace(/^((?:NUXT|NG)_PUBLIC_STORAGE_PREFIX=).*$/gm, `$1${projectName}-local`);

    filesystem.write(envPath, content);
  }

  /**
   * Flatten the cloned nuxt-base-starter wrapper layout so the project's
   * `projects/app/` directory IS the Nuxt app.
   *
   * `lenneTech/nuxt-base-starter` ships a wrapper repo: the root
   * `package.json` is the `create-nuxt-base` scaffolder (a separate npm
   * package — `bin/create-nuxt-base` lives at `index.js`), and the
   * actual Nuxt app lives one level deeper at `nuxt-base-template/`.
   * Without this flatten, the generated monorepo's `pnpm-workspace.yaml`
   * and the README's `cd projects/app && pnpm install && pnpm dev`
   * point at the wrapper, not the app, so `pnpm install` resolves the
   * wrong dependencies and `pnpm dev` has nothing to run
   * (LLM-test 2026-05-03 friction #3 entry 20:30).
   *
   * Defense-in-depth: only mutate the layout if extraction succeeds.
   * If `nuxt-base-template/` is missing or isn't a directory (corrupt
   * clone, future repo reshape that drops the wrapper), we return
   * `{ flattened: false, reason }` and leave the original tree alone.
   * The pre-flatten layout is annoying but functional — better than
   * wiping a user's clone over an unexpected layout.
   *
   * @param dest - The cloned `projects/app/` directory.
   * @returns Whether the flatten ran, plus a reason if it didn't.
   */
  public async flattenNuxtBaseTemplate(dest: string): Promise<{ flattened: boolean; reason?: string }> {
    const { filesystem } = this.toolbox;
    const subdir = filesystem.path(dest, 'nuxt-base-template');

    if (!filesystem.exists(subdir)) {
      return { flattened: false, reason: 'no nuxt-base-template subdirectory' };
    }
    if (!filesystem.isDirectory(subdir)) {
      // Stray file at the path we'd flatten — abort to avoid clobbering
      // the user's tree on a corrupt clone.
      return { flattened: false, reason: 'nuxt-base-template path exists but is not a directory' };
    }

    // Stage the template into a sibling directory before touching `dest`,
    // so a copy failure leaves the original layout intact.
    const parent = filesystem.path(dest, '..');
    const stage = filesystem.path(parent, `.nuxt-base-template-staging-${Date.now()}-${process.pid}`);
    try {
      filesystem.copy(subdir, stage, { overwrite: true });
    } catch (err) {
      // Couldn't stage — leave `dest` untouched and bubble the reason up.
      filesystem.remove(stage);
      return { flattened: false, reason: `failed to stage template: ${(err as Error).message}` };
    }

    try {
      // Wipe the cloned root (wrapper package.json, index.js, lock file,
      // README, etc.) and replace it with the staged template contents.
      // gluegun's `filesystem.remove(dest)` removes the directory, so
      // we re-create it before copying back so dotfiles land at the
      // right level.
      filesystem.remove(dest);
      filesystem.dir(dest);
      filesystem.copy(stage, dest, { overwrite: true });
    } finally {
      filesystem.remove(stage);
    }

    return { flattened: true };
  }

  /**
   * Setup Nuxt frontend
   * Handles template setup (link/copy/clone) and optional npm install
   *
   * @param dest - Destination directory path
   * @param options - Setup options
   * @returns FrontendSetupResult with success status
   */
  public async setupNuxt(dest: string, options: NuxtSetupOptions = {}): Promise<FrontendSetupResult> {
    const { system, templateHelper } = this.toolbox;
    const { branch, copyPath, linkPath, skipInstall } = options;

    // Source the Nuxt app from the nuxt-base-starter repo (priority:
    // link > copy > clone), mirroring the backend (nest-server-starter)
    // flow. The default — no link/copy/branch — clones the repo's default
    // branch, so a fresh init always integrates the CURRENT GitHub template.
    //
    // This deliberately replaces the former `create-nuxt-base@latest` npx
    // path: that package is marked `private` and is no longer published
    // (nuxt-base-starter commit b534af2 — "distribute via lt CLI fullstack
    // template"), so `@latest` was frozen at an outdated copy and the
    // bundled template drifted from GitHub. Cloning the repo directly is
    // the same mechanism the backend already uses and removes that drift.
    const result = await templateHelper.setup(dest, {
      branch,
      copyPath,
      isNuxt: true,
      linkPath,
      repoUrl: linkPath || copyPath ? undefined : 'https://github.com/lenneTech/nuxt-base-starter.git',
    });

    if (!result.success) {
      return { method: result.method, path: result.path, success: false };
    }

    // After a clone, flatten the wrapper layout so `dest` IS the Nuxt app
    // (the cloned root carries the scaffolder; the app lives in
    // `nuxt-base-template/` — see flattenNuxtBaseTemplate). Skip on link
    // mode: a symlink points at the user's checkout and must not be torn out.
    if (result.method === 'clone') {
      await this.flattenNuxtBaseTemplate(dest);
    }

    // The template ships as `nuxt-base-template`: a workspace sub-project becomes
    // "app", a standalone app takes its directory name (`packageName`), because
    // `lt dev` derives the slug from it and every standalone app would otherwise
    // share `app.localhost`. Skip link mode — a symlinked checkout is shared with
    // upstream and must not be mutated.
    if (result.method !== 'link') {
      await this.fixPackageName(dest, options.packageName || 'app');
    }

    // The project's name instead of "Nuxt Base Starter", and no link to the starter repository
    // (DEV-4132, as for Angular). A starter without app/utils/site.ts is skipped silently.
    if (
      result.method !== 'link' &&
      options.siteName &&
      applyNuxtSiteIdentity(dest, options.siteName) === 'unrecognised'
    ) {
      this.toolbox.print.warning(
        'app/utils/site.ts has no SITE_NAME / SITE_REPO_URL lines in the expected shape: the starter title and repository link were left in place.',
      );
    }

    // Run install unless skipped or a symlink. Fullstack init installs at
    // the monorepo level (skipInstall: true); standalone `lt frontend nuxt`
    // installs here (create-nuxt-base used to handle that).
    if (!skipInstall && result.method !== 'link') {
      try {
        const { pm } = this.toolbox;
        // `cwd` instead of `cd "<dest>" &&`: the directory name must not be shell syntax.
        await system.run(pm.install(pm.detect(dest)), { cwd: dest });
      } catch {
        return { method: result.method, path: dest, success: false };
      }
    }

    return { method: result.method, path: result.path, success: true };
  }

  /**
   * Setup Angular frontend
   * Handles template setup, npm install, husky removal, git init, and localize
   *
   * @param dest - Destination directory path
   * @param options - Setup options
   * @returns FrontendSetupResult with success status
   */
  public async setupAngular(dest: string, options: AngularSetupOptions = {}): Promise<FrontendSetupResult> {
    const { filesystem, patching, system, templateHelper } = this.toolbox;
    const {
      branch,
      copyPath,
      gitLink,
      linkPath,
      localize = false,
      skipGitInit = false,
      skipHuskyRemoval = false,
      skipInstall = false,
    } = options;

    // Setup template
    const result = await templateHelper.setup(dest, {
      branch,
      copyPath,
      linkPath,
      repoUrl: 'https://github.com/lenneTech/ng-base-starter',
    });

    if (!result.success) {
      return { method: result.method, path: result.path, success: false };
    }

    // Link mode: skip all post-processing
    if (result.method === 'link') {
      return { method: 'link', path: result.path, success: true };
    }

    // A new app is not a copy of the starter, standalone or in a workspace: the starter's
    // CI, release tooling and changelog go, and package.json gets the app's own identity.
    // Standalone kept all of it until ng-base-starter reported it (2026-11-11).
    this.removeAngularStarterRepoFiles(dest);
    await patching.update(`${dest}/package.json`, (data: Record<string, unknown>) =>
      applyScaffoldIdentity(data, { name: options.packageName || 'app', version: '0.0.0' }),
    );

    if (options.siteName && applyAngularSiteIdentity(dest, options.siteName) === 'unrecognised') {
      this.toolbox.print.warning(
        'src/app/shared/site.ts has no SITE_NAME / SITE_REPO_URL lines in the expected shape: the starter title and repository link were left in place.',
      );
    }

    if (options.localNgBaseBuild && !options.vendor) {
      const pkg = filesystem.read(`${dest}/package.json`, 'json') as Record<string, any>;
      if (pkg && typeof pkg === 'object') {
        applyLocalNgBaseDependency(pkg, options.localNgBaseBuild);
        filesystem.write(`${dest}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
      }
    }

    if (options.vendor) {
      try {
        await this.convertAngularAppToVendored({
          dest,
          localSource: options.vendor.localSource,
          source: '`lt frontend angular`',
        });
      } catch (err) {
        this.toolbox.print.warning(`Vendor conversion failed, continuing in npm mode: ${(err as Error).message}`);
      }
    }

    // Install packages
    if (!skipInstall) {
      try {
        const { pm } = this.toolbox;
        // `cwd` instead of `cd "<dest>" &&`: the directory name must not be shell syntax.
        await system.run(pm.install(pm.detect(dest)), { cwd: dest });
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Initialize git
    if (!skipGitInit) {
      try {
        // Argument lists, no shell: gitLink comes from a CLI flag or lt.config (see exec-args.ts).
        await execArgs('git', ['init', '--initial-branch=main'], { cwd: dest });
        if (gitLink) {
          await execArgs('git', ['remote', 'add', '--', 'origin', gitLink], { cwd: dest });
          await execArgs('git', ['add', '.'], { cwd: dest });
          await execArgs('git', ['commit', '-m', 'Initial commit'], { cwd: dest });
          await execArgs('git', ['push', '-u', 'origin', 'main'], { cwd: dest });
        }
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Remove husky. A workspace keeps one set of git hooks at its root; a husky inside
    // projects/app would rewrite the workspace's `core.hooksPath` on install.
    if (!skipHuskyRemoval || options.workspace) {
      filesystem.remove(`${dest}/.husky`);
      await patching.update(`${dest}/package.json`, (data: Record<string, unknown>) => {
        if (data.scripts && typeof data.scripts === 'object') {
          const scripts = data.scripts as Record<string, unknown>;
          // `prepare` goes when it runs husky or the workspace root owns the hooks. A
          // standalone app is its own git root and keeps `simple-git-hooks` (ng-base-starter
          // 22): deleting it unconditionally meant its pre-commit and pre-push hooks never
          // installed.
          if (options.workspace || /\bhusky\b/.test(String(scripts.prepare ?? ''))) {
            delete scripts.prepare;
          }
        }
        if (data.devDependencies && typeof data.devDependencies === 'object') {
          delete (data.devDependencies as Record<string, unknown>).husky;
        }
        return data;
      });
    }

    // Add localize
    if (localize) {
      try {
        await system.run('ng add @angular/localize --skip-confirmation', { cwd: dest });
      } catch {
        // Localize failure is not fatal
      }
    }

    // Run init script if exists
    if (!skipInstall) {
      try {
        const { pm: pmHelper } = this.toolbox;
        await system.run(pmHelper.run('init', pmHelper.detect(dest)), { cwd: dest });
      } catch {
        // Init script failure is not fatal
      }
    }

    return { method: result.method, path: dest, success: true };
  }

  /**
   * Removes the starter's repo-only files ({@link ANGULAR_STARTER_REPO_ONLY}, release
   * configs, release scripts) and an npm lockfile: the app installs with pnpm, from
   * its own `pnpm-lock.yaml` standalone and from the root lockfile in a workspace.
   * Never follows a symlink.
   */
  public removeAngularStarterRepoFiles(dest: string): string[] {
    const fs = require('node:fs');
    const path = require('node:path');
    const removed: string[] = [];
    const remove = (rel: string): void => {
      const target = path.join(dest, rel);
      try {
        fs.lstatSync(target);
      } catch {
        return;
      }
      fs.rmSync(target, { force: true, recursive: true });
      removed.push(rel);
    };
    for (const rel of [...ANGULAR_STARTER_REPO_ONLY, 'package-lock.json']) {
      remove(rel);
    }
    const listDir = (dir: string): string[] => {
      try {
        return fs.readdirSync(path.join(dest, dir));
      } catch {
        return [];
      }
    };
    for (const name of listDir('.')) {
      if (name.startsWith('.release-it')) remove(name);
    }
    for (const name of listDir('scripts')) {
      if (name.startsWith('release')) remove(path.join('scripts', name));
    }
    return removed;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Frontend Vendor Mode — @lenne.tech/ng-base (Angular)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Vendors `@lenne.tech/ng-base` into an Angular app (`src/core/`), see
   * `src/lib/ng-base-vendor.ts` for the layout and why no import is rewritten.
   *
   * Source, by priority: `localSource` (a local ng-base checkout, copied from its
   * working tree, for testing unreleased work), else a clone of `upstreamRef`, else of
   * the tag of the version the app pins (`v<version>`), else of the default branch.
   */
  async convertAngularAppToVendored(options: {
    dest: string;
    localSource?: string;
    source?: string;
    upstreamRef?: string;
    upstreamRepoUrl?: string;
  }): Promise<{ added: string[]; entryPoints: string[]; version?: string }> {
    const { dest, localSource, upstreamRef, upstreamRepoUrl = NG_BASE_REPO_URL } = options;
    const path = require('node:path');
    const { filesystem, print } = this.toolbox;

    if (isVendoredNgBaseProject(dest)) {
      throw new Error('Project is already in vendor mode (src/core/VENDOR.md exists).');
    }
    const pkgPath = path.join(dest, 'package.json');
    const pkg = filesystem.read(pkgPath, 'json') as Record<string, any>;
    if (!pkg || typeof pkg !== 'object') {
      throw new Error(`Cannot read ${pkgPath}`);
    }

    let libraryDir: string | undefined;
    let tmpClone: string | undefined;
    let commit = '';
    if (localSource) {
      libraryDir = resolveNgBaseLibraryDir(localSource);
      if (!libraryDir) {
        throw new Error(
          `${localSource} is no ng-base source: expected projects/ng-base/index.ts + ng-package.json below it, or the library directory itself.`,
        );
      }
      try {
        commit = (await execArgs('git', ['-C', libraryDir, 'rev-parse', 'HEAD'])).trim();
      } catch {
        // Not a git checkout — the baseline then names no commit.
      }
    } else {
      const pinned = pinnedNgBaseVersion(pkg);
      const ref = upstreamRef || (pinned ? ngBaseTag(pinned) : undefined);
      if (!ref) {
        print.warning(`  ${NG_BASE_PACKAGE} has no version pin in package.json — vendoring the default branch.`);
      }
      tmpClone = path.join(require('os').tmpdir(), `lt-vendor-ng-base-${Date.now()}-${process.pid}`);
      try {
        // Argument list, no shell: the ref comes from a CLI flag or lt.config (see exec-args.ts).
        await execArgs('git', [
          'clone',
          '--depth',
          '1',
          ...(ref ? ['--branch', ref] : []),
          '--',
          upstreamRepoUrl,
          tmpClone,
        ]);
        commit = (await execArgs('git', ['-C', tmpClone, 'rev-parse', 'HEAD'])).trim();
      } catch (err) {
        filesystem.remove(tmpClone);
        const hint = ref ? ` ng-base tags carry a "v" (e.g. "v22.0.0"); check ${upstreamRepoUrl} for "${ref}".` : '';
        throw new Error(
          `Failed to clone ${upstreamRepoUrl}${ref ? ` (${ref})` : ''}: ${(err as Error).message}${hint}`,
        );
      }
      libraryDir = resolveNgBaseLibraryDir(tmpClone);
      if (!libraryDir) {
        filesystem.remove(tmpClone);
        throw new Error(
          `${upstreamRepoUrl}${ref ? ` (${ref})` : ''} has no projects/ng-base/index.ts — ng-base before 22.0.0 cannot be vendored.`,
        );
      }
    }

    const coreDir = path.join(dest, NG_BASE_CORE_DIR);
    let library: Record<string, any> = {};
    let entryPoints: string[] = [];
    try {
      library = (filesystem.read(path.join(libraryDir, 'package.json'), 'json') as Record<string, any>) || {};
      if (!removeVendoredNgBase(dest) && filesystem.exists(coreDir)) {
        throw new Error(`${coreDir} is a symlink — refusing to replace it.`);
      }
      copyNgBaseSource(libraryDir, coreDir);
      const license = path.join(libraryDir, '..', '..', 'LICENSE');
      if (filesystem.exists(license)) {
        filesystem.copy(license, path.join(coreDir, 'LICENSE'), { overwrite: true });
      }
      entryPoints = ngBaseEntryPoints(coreDir);
    } finally {
      if (tmpClone) {
        filesystem.remove(tmpClone);
      }
    }

    const tsconfig = setNgBaseTsconfigPaths(dest, 'vendor');
    if (tsconfig === 'missing' || tsconfig === 'unparseable') {
      const wanted = Object.entries(ngBaseTsconfigPaths(coreDir))
        .map(([key, [target]]) => `${key} → ${target}`)
        .join(', ');
      print.warning(
        `  ⚠ tsconfig.json is ${tsconfig === 'missing' ? 'missing' : 'not parseable'} — add these compilerOptions.paths by hand: ${wanted}`,
      );
    } else if (tsconfig === 'no-entries') {
      // resolveNgBaseLibraryDir already demanded a root ng-package.json with an existing entry
      // file, so this only happens when the copy itself went wrong. Nothing else was changed
      // yet: take the copy back so the app is left as it was.
      removeVendoredNgBase(dest);
      throw new Error(`${coreDir} has no ng-package.json with an existing lib.entryFile — nothing to map.`);
    }

    // The tsconfig mapping reaches TypeScript only; the stylesheet imports need the vendored path too.
    rewriteNgBaseStyleImports(dest, 'vendor');

    const added = applyVendorDependencies(pkg, library);
    if (pkg.scripts && typeof pkg.scripts === 'object') {
      pkg.scripts['check:vendor-freshness'] = vendorFreshnessScript('src/core/VENDOR.md', NG_BASE_PACKAGE);
      hookCheckFreshness(pkg.scripts);
    }
    filesystem.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    filesystem.write(
      path.join(coreDir, 'VENDOR.md'),
      buildNgBaseVendorMd({
        commit,
        date: new Date().toISOString().slice(0, 10),
        source: options.source || '`lt frontend convert-mode --to vendor`',
        version: library.version,
      }),
    );

    // CLAUDE.md and AGENTS.md: ng-base-starter keeps the two identical (`agentDocFiles`).
    for (const docPath of agentDocFiles(dest, [dest])) {
      const existing = filesystem.read(docPath) || '';
      const patched = insertVendorBlockIfMissing(existing, FRONTEND_VENDOR_MARKER, buildFrontendVendorBlock('angular'));
      if (patched !== existing) {
        filesystem.write(docPath, patched);
      }
    }

    return { added, entryPoints, version: library.version };
  }

  /**
   * Reverse of {@link convertAngularAppToVendored}: removes `src/core/` and the tsconfig
   * mapping and restores the `@lenne.tech/ng-base` dependency at the baseline version
   * (or `targetVersion`). The peers vendor mode added stay: they are valid npm-mode
   * dependencies too.
   */
  async convertAngularAppToNpmMode(options: {
    dest: string;
    localSource?: string;
    targetVersion?: string;
  }): Promise<{ version: string }> {
    const { dest, localSource, targetVersion } = options;
    const path = require('node:path');
    const { filesystem, print } = this.toolbox;

    if (!isVendoredNgBaseProject(dest)) {
      throw new Error('Project is not in vendor mode (src/core/VENDOR.md naming @lenne.tech/ng-base not found).');
    }
    // A local build instead of the registry version: refuse before anything is removed.
    const localBuild = localSource ? resolveLocalNgBaseBuild(localSource) : undefined;
    if (localBuild?.error) {
      throw new Error(localBuild.error);
    }
    const version = targetVersion || vendoredNgBaseVersion(dest);
    if (!version) {
      throw new Error('Cannot determine target version. Specify --version or ensure VENDOR.md has a Baseline-Version.');
    }
    const vendorMd = filesystem.read(path.join(dest, NG_BASE_CORE_DIR, 'VENDOR.md')) || '';
    if (/\|\s*\d{4}-[^|]*\|[^|]*\|[^|]*\|/.test(vendorMd.split(/## Local changes/i)[1] || '')) {
      print.warning('VENDOR.md documents local patches in src/core/ that will be LOST.');
      print.warning('Consider running /lt-dev:frontend:contribute-ng-base-core first to upstream them.');
    }

    if (!removeVendoredNgBase(dest)) {
      throw new Error(`${path.join(dest, NG_BASE_CORE_DIR)} is a symlink — refusing to remove it.`);
    }
    setNgBaseTsconfigPaths(dest, 'npm');
    rewriteNgBaseStyleImports(dest, 'npm');

    const pkgPath = path.join(dest, 'package.json');
    const pkg = filesystem.read(pkgPath, 'json') as Record<string, any>;
    if (pkg && typeof pkg === 'object') {
      if (localBuild?.distDir) {
        applyLocalNgBaseDependency(pkg, localBuild.distDir);
      } else {
        // EXACT, not `^`: ng-base-starter pins it exactly (vendor mode clones the tag of that
        // pin), and its `check-ng-base-pin.mjs` fails a range in CI.
        pkg.dependencies = { ...(pkg.dependencies || {}), [NG_BASE_PACKAGE]: version };
        pkg.dependencies = Object.fromEntries(
          Object.entries(pkg.dependencies as Record<string, string>).sort(([a], [b]) => a.localeCompare(b)),
        );
      }
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        unhookCheckFreshness(pkg.scripts);
      }
      filesystem.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }

    for (const docPath of agentDocFiles(dest, [dest])) {
      const content = filesystem.read(docPath) || '';
      const cleaned = removeVendorBlock(content, FRONTEND_VENDOR_MARKER);
      if (cleaned !== content) {
        filesystem.write(docPath, cleaned);
      }
    }
    return { version };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Frontend Vendor Mode — @lenne.tech/nuxt-extensions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Convert an existing npm-mode frontend project to vendor mode.
   *
   * Validates that the project currently uses @lenne.tech/nuxt-extensions
   * as an npm dependency, then delegates to convertAppCloneToVendored.
   */
  async convertAppToVendorMode(options: {
    dest: string;
    upstreamBranch?: string;
    upstreamRepoUrl?: string;
  }): Promise<void> {
    const { dest, upstreamBranch, upstreamRepoUrl } = options;

    if (isVendoredAppProject(dest)) {
      throw new Error('Project is already in vendor mode (app/core/VENDOR.md exists).');
    }

    const pkg = this.toolbox.filesystem.read(`${dest}/package.json`, 'json') as Record<string, any>;
    if (!pkg) {
      throw new Error('Cannot read package.json');
    }
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (!allDeps['@lenne.tech/nuxt-extensions']) {
      throw new Error(
        '@lenne.tech/nuxt-extensions is not in dependencies or devDependencies. ' +
          'Is this an npm-mode lenne.tech frontend project?',
      );
    }

    await this.convertAppCloneToVendored({
      dest,
      upstreamBranch,
      upstreamRepoUrl,
    });
  }

  /**
   * Convert an existing vendor-mode frontend project back to npm mode.
   *
   * Performs the inverse of convertAppCloneToVendored:
   * 1. Read baseline version from VENDOR.md
   * 2. Rewrite consumer imports from relative paths back to @lenne.tech/nuxt-extensions
   * 3. Delete app/core/
   * 4. Restore @lenne.tech/nuxt-extensions dependency in package.json
   * 5. Rewrite nuxt.config.ts module entry
   * 6. Remove vendor-specific scripts and CLAUDE.md marker
   */
  async convertAppToNpmMode(options: { dest: string; targetVersion?: string }): Promise<void> {
    const { dest, targetVersion } = options;
    const { filesystem } = this.toolbox;
    const path = require('node:path');

    if (!isVendoredAppProject(dest)) {
      throw new Error('Project is not in vendor mode (app/core/VENDOR.md not found).');
    }

    const coreDir = path.join(dest, 'app', 'core');

    // ── 1. Determine target version + warn about local patches ──────────
    const vendorMd = filesystem.read(path.join(coreDir, 'VENDOR.md')) || '';

    let version = targetVersion;
    if (!version) {
      const match = vendorMd.match(/Baseline-Version[^0-9]*(\d+\.\d+\.\d+\S*)/);
      if (match) {
        version = match[1];
      }
    }
    if (!version) {
      throw new Error('Cannot determine target version. Specify --version or ensure VENDOR.md has a Baseline-Version.');
    }

    // Warn if VENDOR.md documents local patches that will be lost
    const localChangesSection = vendorMd.match(/## Local changes[\s\S]*?(?=## |$)/i);
    if (localChangesSection) {
      const hasRealPatches =
        localChangesSection[0].includes('|') &&
        !localChangesSection[0].includes('(none, pristine)') &&
        /\|\s*\d{4}-/.test(localChangesSection[0]);
      if (hasRealPatches) {
        const { print } = this.toolbox;
        print.warning('');
        print.warning('VENDOR.md documents local patches in app/core/ that will be LOST:');
        const rows = localChangesSection[0].split('\n').filter((l: string) => /^\|\s*\d{4}-/.test(l));
        for (const row of rows.slice(0, 5)) {
          print.info(`  ${row.trim()}`);
        }
        if (rows.length > 5) {
          print.info(`  ... and ${rows.length - 5} more`);
        }
        print.warning('Consider running /lt-dev:frontend:contribute-nuxt-extensions-core first to upstream them.');
        print.warning('');
      }
    }

    // ── 2. Rewrite consumer imports: relative → @lenne.tech/nuxt-extensions ─
    this.rewriteConsumerImportsToNpm(dest);

    // ── 3. Delete app/core/ ──────────────────────────────────────────────
    if (filesystem.exists(coreDir)) {
      filesystem.remove(coreDir);
    }

    // ── 4. Restore @lenne.tech/nuxt-extensions in package.json ──────────
    const pkgPath = path.join(dest, 'package.json');
    if (filesystem.exists(pkgPath)) {
      const pkg = filesystem.read(pkgPath, 'json') as Record<string, any>;
      if (pkg && typeof pkg === 'object') {
        if (!pkg.dependencies) pkg.dependencies = {};
        // EXACT, not `^`: consumers pin the lenne.tech frameworks exactly, since a MINOR may
        // carry a migration, and vendor mode clones the tag of exactly that pin.
        (pkg.dependencies as Record<string, string>)['@lenne.tech/nuxt-extensions'] = version;

        // Remove vendor-specific scripts
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          const scripts = pkg.scripts as Record<string, string>;
          unhookCheckFreshness(scripts);
        }

        filesystem.write(pkgPath, pkg, { jsonIndent: 2 });
      }
    }

    // ── 5. Rewrite nuxt.config.ts module entry ──────────────────────────
    this.rewriteNuxtConfig(dest, 'npm');

    // ── 6. Clean CLAUDE.md vendor marker ─────────────────────────────────
    const claudeMdPath = path.join(dest, 'CLAUDE.md');
    if (filesystem.exists(claudeMdPath)) {
      const content = filesystem.read(claudeMdPath) || '';
      const cleaned = removeVendorBlock(content, FRONTEND_VENDOR_MARKER);
      if (cleaned !== content) {
        filesystem.write(claudeMdPath, cleaned);
      }
    }

    // ── Post-conversion verification ─────────────────────────────────────
    const stale = this.findStaleFrontendImports(dest, isRelativeCoreImport);
    if (stale.length > 0) {
      const { print } = this.toolbox;
      print.warning(`${stale.length} file(s) still contain relative core imports after npm conversion:`);
      for (const f of stale.slice(0, 10)) {
        print.info(`  ${f}`);
      }
      print.info('These imports must be manually rewritten to @lenne.tech/nuxt-extensions.');
    }
  }

  /**
   * Core vendoring pipeline for @lenne.tech/nuxt-extensions.
   *
   * Clones the upstream repo, copies module.ts + runtime/ into app/core/,
   * rewrites nuxt.config.ts and explicit consumer imports, merges deps,
   * creates VENDOR.md and patches CLAUDE.md.
   */
  async convertAppCloneToVendored(options: {
    dest: string;
    projectName?: string;
    upstreamBranch?: string;
    upstreamRepoUrl?: string;
  }): Promise<{ upstreamDeps: Record<string, string> }> {
    const { dest, upstreamBranch, upstreamRepoUrl = 'https://github.com/lenneTech/nuxt-extensions.git' } = options;

    const path = require('node:path');
    const { filesystem } = this.toolbox;
    const coreDir = path.join(dest, 'app', 'core');

    // ── 1. Clone @lenne.tech/nuxt-extensions into temp dir ──────────────
    //
    // Which release: an explicit ref wins. Otherwise the version the app pins, i.e. the one
    // npm mode installs, as for nest-server and ng-base. The default branch carries merged
    // work between a merge and its release, and every project created in that window got
    // it. A pinned version without a tag is an error, never a quiet clone of the default
    // branch instead.
    const pinnedVersion = upstreamBranch
      ? undefined
      : pinnedNuxtExtensionsVersion(filesystem.read(path.join(dest, 'package.json'), 'json'));
    const ref = upstreamBranch || pinnedVersion;
    if (!ref) {
      this.toolbox.print.warning(
        '  @lenne.tech/nuxt-extensions has no version pin in package.json — vendoring the default branch.',
      );
    }
    const tmpClone = path.join(require('os').tmpdir(), `lt-vendor-nuxt-ext-${Date.now()}`);
    try {
      // Argument list, no shell: the ref comes from a CLI flag, lt.config or the app's
      // package.json (see exec-args.ts).
      await execArgs('git', [
        'clone',
        '--depth',
        '1',
        ...(ref ? ['--branch', ref] : []),
        '--',
        upstreamRepoUrl,
        tmpClone,
      ]);
    } catch (err) {
      const raw = (err as Error).message || '';
      const hints: string[] = [];
      if (/Could not resolve host|getaddrinfo|ECONNREFUSED|Network is unreachable/i.test(raw)) {
        hints.push('Network issue reaching github.com — check your connection or proxy settings.');
      }
      if (/Permission denied|authentication failed|publickey|403|401/i.test(raw)) {
        hints.push('Authentication issue — the CLI uses an anonymous HTTPS clone; verify GitHub is reachable.');
      }
      if (pinnedVersion && isMissingCloneRef(raw)) {
        hints.push(
          `package.json pins @lenne.tech/nuxt-extensions ${pinnedVersion}, but ${upstreamRepoUrl} has no tag ` +
            `"${pinnedVersion}": that version is not released. The default branch is not vendored instead, ` +
            `it may hold unreleased work. Release nuxt-extensions ${pinnedVersion} first, or pin a released version.`,
        );
      } else if (ref && isMissingCloneRef(raw)) {
        hints.push(
          `Upstream ref "${ref}" does not exist. Check ${upstreamRepoUrl}/tags for valid refs. ` +
            'Note: nuxt-extensions tags have NO "v" prefix — use e.g. "4.0.0", not "v4.0.0".',
        );
      }
      if (/already exists and is not an empty/i.test(raw)) {
        hints.push(`Target ${tmpClone} already exists. rm -rf /tmp/lt-vendor-nuxt-ext-* and retry.`);
      }
      const hintBlock = hints.length > 0 ? `\n  Hints:\n    - ${hints.join('\n    - ')}` : '';
      throw new Error(
        `Failed to clone ${upstreamRepoUrl}${ref ? ` (branch/tag: ${ref})` : ''}.\n  Raw git error: ${raw.trim()}${hintBlock}`,
      );
    }

    // Snapshot upstream metadata
    let upstreamDeps: Record<string, string> = {};
    let upstreamDevDeps: Record<string, string> = {};
    let upstreamPeerDeps: Record<string, string> = {};
    let upstreamVersion = '';
    try {
      const upstreamPkg = filesystem.read(`${tmpClone}/package.json`, 'json') as Record<string, any>;
      if (upstreamPkg && typeof upstreamPkg === 'object') {
        upstreamDeps = (upstreamPkg.dependencies as Record<string, string>) || {};
        upstreamDevDeps = (upstreamPkg.devDependencies as Record<string, string>) || {};
        upstreamPeerDeps = (upstreamPkg.peerDependencies as Record<string, string>) || {};
        upstreamVersion = (upstreamPkg.version as string) || '';
      }
    } catch {
      // Best-effort
    }

    let upstreamClaudeMd = '';
    try {
      const c = filesystem.read(`${tmpClone}/CLAUDE.md`);
      if (typeof c === 'string') upstreamClaudeMd = c;
    } catch {
      // Non-fatal
    }

    let upstreamCommit = '';
    try {
      const sha = await execArgs('git', ['-C', tmpClone, 'rev-parse', 'HEAD']);
      upstreamCommit = (sha || '').trim();
    } catch {
      // Non-fatal
    }

    try {
      // ── 2. Copy source files to app/core/ ─────────────────────────────
      if (filesystem.exists(coreDir)) {
        filesystem.remove(coreDir);
      }

      const copies: [string, string][] = [
        [`${tmpClone}/src/module.ts`, `${coreDir}/module.ts`],
        [`${tmpClone}/src/index.ts`, `${coreDir}/index.ts`],
        [`${tmpClone}/src/runtime`, `${coreDir}/runtime`],
        [`${tmpClone}/LICENSE`, `${coreDir}/LICENSE`],
      ];
      for (const [from, to] of copies) {
        if (filesystem.exists(from)) {
          filesystem.copy(from, to);
        }
      }
    } finally {
      // Always clean up temp clone
      if (filesystem.exists(tmpClone)) {
        filesystem.remove(tmpClone);
      }
    }

    // No flatten-fix needed — nuxt-extensions source structure is already
    // flat (module.ts + runtime/ at the same level). Unlike the backend
    // (nest-server) where src/index.ts and src/core/ must be merged into
    // one directory, nuxt-extensions keeps everything directly under src/.

    // ── 3. Rewrite consumer explicit imports ─────────────────────────────
    //
    // Most consumer code uses Nuxt auto-imports (composables, utils,
    // components) which the module.ts registers via addImports/addComponent.
    // However, a few explicit imports exist:
    //   - Type imports: `from '@lenne.tech/nuxt-extensions'` (e.g. LtUser, LtUploadItem)
    //   - Testing imports: `from '@lenne.tech/nuxt-extensions/testing'`
    //
    // These must be rewritten to relative paths to app/core.
    this.rewriteConsumerImportsToVendor(dest);

    // ── 4. Rewrite nuxt.config.ts module entry ──────────────────────────
    this.rewriteNuxtConfig(dest, 'vendor');

    // ── 4b. Drop the core's `nuxt/schema` runtime-config augmentation ────
    //
    // Harmless inside node_modules, poisonous as project source: it augments the
    // same interface under both `nuxt/schema` and `@nuxt/schema` (the former
    // re-exports the latter) and closes a cycle with Nuxt's generated
    // runtime-config types. TS2310 — suppressed by `skipLibCheck`, so all a
    // developer sees is every `config.public.*` typed `unknown`. See the lib for
    // the measurement.
    const strippedAugmentation = stripVendorSchemaAugmentation({ coreDir, filesystem });
    if (strippedAugmentation.touched.length > 0) {
      this.toolbox.print.info(
        `  vendored core: removed the nuxt/schema runtime-config augmentation from ${strippedAugmentation.touched.length} file(s) — keeps config.public.* typed`,
      );
    }
    // A block the transform could not process is left in place, which means the
    // TS2310 bug ships with the project. Silence there would be the worst of both
    // worlds: the conversion reports success and the typing is broken anyway.
    for (const warning of strippedAugmentation.warnings) {
      this.toolbox.print.warning(`  ⚠ vendored core: ${warning}`);
    }

    // ── 5. package.json: remove @lenne.tech/nuxt-extensions, merge deps ─
    const pkgPath = path.join(dest, 'package.json');
    if (filesystem.exists(pkgPath)) {
      const pkg = filesystem.read(pkgPath, 'json') as Record<string, any>;
      if (pkg && typeof pkg === 'object') {
        if (pkg.dependencies && typeof pkg.dependencies === 'object') {
          delete pkg.dependencies['@lenne.tech/nuxt-extensions'];
        }
        if (pkg.devDependencies && typeof pkg.devDependencies === 'object') {
          delete pkg.devDependencies['@lenne.tech/nuxt-extensions'];
        }

        // Merge upstream deps (mainly @nuxt/kit)
        if (!pkg.dependencies) pkg.dependencies = {};
        const deps = pkg.dependencies as Record<string, string>;
        for (const [depName, depVersion] of Object.entries(upstreamDeps)) {
          if (depName === '@lenne.tech/nuxt-extensions') continue;
          if (!(depName in deps)) {
            deps[depName] = depVersion;
          }
        }

        // Promote any upstream devDeps flagged as runtime-needed (via
        // vendor-frontend-runtime-deps.json) into dependencies. Currently
        // empty for nuxt-extensions but reserved for future additions.
        for (const [depName, depVersion] of Object.entries(upstreamDevDeps)) {
          if (this.isFrontendVendorRuntimeDep(depName) && !(depName in deps)) {
            deps[depName] = depVersion;
          }
        }

        // Raise the pins the app shares with the vendored module, by the same rule as the
        // backend conversion (src/lib/align-framework-pins.ts): only what the app already
        // declares, never lowered, and a framework devDependency never sets a runtime pin, so
        // `nuxt` / `vue` stay the app's own. The merge above only ADDS packages.
        const aligned = alignFrameworkPins(pkg, { dependencies: upstreamDeps, devDependencies: upstreamDevDeps });
        if (aligned.raised.length > 0) {
          const changes = aligned.raised.map((change) => `${change.name} ${change.from} → ${change.to}`).join(', ');
          this.toolbox.print.info(`  aligned ${aligned.raised.length} pin(s) with nuxt-extensions: ${changes}`);
        }
        for (const entry of aligned.skipped) {
          this.toolbox.print.warning(
            `  ⚠ ${entry.section}.${entry.name} is "${entry.current}", not a version or range — not aligned with nuxt-extensions.`,
          );
        }

        // Verify peer deps are present (they should already be from the starter)
        for (const [depName] of Object.entries(upstreamPeerDeps)) {
          if (!(depName in deps) && !(depName in (pkg.devDependencies || {}))) {
            const { print } = this.toolbox;
            print.warning(`Peer dependency ${depName} is missing — you may need to install it.`);
          }
        }

        // Vendor freshness check script
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          const scripts = pkg.scripts as Record<string, string>;
          scripts['check:vendor-freshness'] = [
            'node -e "',
            "var f=require('fs'),h=require('https');",
            "try{var c=f.readFileSync('app/core/VENDOR.md','utf8')}catch(e){process.exit(0)}",
            'var m=c.match(/Baseline-Version[^0-9]*(\\d+\\.\\d+\\.\\d+)/);',
            "if(!m){process.stderr.write(String.fromCharCode(9888)+' vendor-freshness: no baseline\\n');process.exit(0)}",
            'var v=m[1];',
            "h.get('https://registry.npmjs.org/@lenne.tech/nuxt-extensions/latest',function(r){",
            "var d='';r.on('data',function(c){d+=c});r.on('end',function(){",
            'try{var l=JSON.parse(d).version;',
            "if(v===l)console.log('vendor core up-to-date (v'+v+')');",
            "else process.stderr.write('vendor core v'+v+', latest v'+l+'\\n')",
            "}catch(e){}})}).on('error',function(){});",
            'setTimeout(function(){process.exit(0)},5000)',
            '"',
          ].join('');

          // Hook freshness into the check scripts (targets check:raw, never the
          // check.mjs wrapper). See the shared lib helper.
          hookCheckFreshness(scripts);
        }

        // Sort dependency maps alphabetically so merged-in entries
        // (e.g. upstream `@nuxt/kit`) end up in the expected position
        // and the generated package.json passes oxfmt/format:check.
        const sortObjectKeys = (obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
          if (!obj) return obj;
          return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
        };
        pkg.dependencies = sortObjectKeys(pkg.dependencies as Record<string, unknown>);
        pkg.devDependencies = sortObjectKeys(pkg.devDependencies as Record<string, unknown>);
        pkg.peerDependencies = sortObjectKeys(pkg.peerDependencies as Record<string, unknown>);
        // Ensure trailing newline — oxfmt with the starter's .editorconfig
        // `insert_final_newline = true` requires it.
        filesystem.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      }
    }

    // ── 6. CLAUDE.md: prepend vendor marker + merge upstream sections ────
    const claudeMdPath = path.join(dest, 'CLAUDE.md');
    if (filesystem.exists(claudeMdPath)) {
      const existing = filesystem.read(claudeMdPath) || '';
      const patched = insertVendorBlockIfMissing(existing, FRONTEND_VENDOR_MARKER, buildFrontendVendorBlock());
      if (patched !== existing) {
        filesystem.write(claudeMdPath, patched);
      }
    }

    // Merge upstream CLAUDE.md sections
    if (upstreamClaudeMd && filesystem.exists(claudeMdPath)) {
      const projectContent = filesystem.read(claudeMdPath) || '';
      const upstreamSections = this.parseH2Sections(upstreamClaudeMd);
      const projectSections = this.parseH2Sections(projectContent);

      const newSections: string[] = [];
      for (const [heading, body] of upstreamSections) {
        if (heading === '__preamble__') continue;
        if (!projectSections.has(heading)) {
          newSections.push(`## ${heading}\n\n${body.trim()}`);
        }
      }

      if (newSections.length > 0) {
        const separator = projectContent.endsWith('\n') ? '\n' : '\n\n';
        filesystem.write(claudeMdPath, `${projectContent}${separator}${newSections.join('\n\n')}\n`);
      }
    }

    // ── 7. VENDOR.md baseline ────────────────────────────────────────────
    const vendorMdPath = path.join(coreDir, 'VENDOR.md');
    if (!filesystem.exists(vendorMdPath)) {
      const today = new Date().toISOString().slice(0, 10);
      const versionLine = upstreamVersion
        ? `- **Baseline-Version:** ${upstreamVersion}`
        : '- **Baseline-Version:** (not detected)';
      const commitLine = upstreamCommit
        ? `- **Baseline-Commit:** \`${upstreamCommit}\``
        : '- **Baseline-Commit:** (not detected)';
      const syncHistoryTo = upstreamVersion
        ? `${upstreamVersion}${upstreamCommit ? ` (\`${upstreamCommit.slice(0, 10)}\`)` : ''}`
        : 'initial import';
      filesystem.write(
        vendorMdPath,
        [
          '# @lenne.tech/nuxt-extensions (vendored)',
          '',
          'This directory is a curated vendor copy of `@lenne.tech/nuxt-extensions`.',
          'It is first-class project code, not a node_modules shadow copy — but it',
          'is **not a fork**. The copy exists so Claude Code (and humans) can read',
          'framework internals directly. Log substantial local changes in the',
          '"Local changes" table below so the `nuxt-extensions-core-updater` agent',
          'can classify them at sync time.',
          '',
          'Unlike the backend (nest-server) vendoring, no flatten-fix is needed —',
          'the nuxt-extensions source structure is already flat.',
          '',
          '## Modification Policy',
          '',
          'Edit `app/core/` **only** when the change is generally useful to every',
          '@lenne.tech/nuxt-extensions consumer:',
          '',
          '- Bugfixes that apply to every consumer',
          '- Broad framework enhancements (new composables, better defaults, SSR fixes)',
          '- Security vulnerability fixes',
          '- Type/config compatibility fixes every consumer would hit',
          '',
          'Everything else stays **outside** `app/core/`. Project-specific business',
          'rules, customer branding, and proprietary integrations belong in project',
          'code (`app/composables/`, `app/components/`, `app/middleware/`, plugin',
          'overrides).',
          '',
          'Generally-useful changes **MUST** be submitted as an upstream PR to',
          'https://github.com/lenneTech/nuxt-extensions. Run',
          '`/lt-dev:frontend:contribute-nuxt-extensions-core` to prepare it — the',
          'agent filters cosmetic commits, categorizes local changes as',
          'upstream-candidate vs. project-specific, and writes PR drafts for human',
          "review. Letting useful fixes rot in one project's vendor tree is an",
          'anti-pattern: they belong upstream so every consumer benefits and the',
          'local patch disappears on the next sync.',
          '',
          'When in doubt, ask before editing `app/core/`.',
          '',
          '## Baseline',
          '',
          '- **Upstream-Repo:** https://github.com/lenneTech/nuxt-extensions',
          versionLine,
          commitLine,
          `- **Vendored am:** ${today}`,
          '- **Vendored von:** lt CLI (`lt frontend convert-mode --to vendor`)',
          '',
          '## Sync history',
          '',
          ...formatMarkdownTable(
            ['Date', 'From', 'To', 'Notes'],
            [[today, '—', syncHistoryTo, 'scaffolded by lt CLI']],
          ),
          '',
          '## Local changes',
          '',
          ...formatMarkdownTable(
            ['Date', 'Commit', 'Scope', 'Reason', 'Status'],
            [['—', '—', '(none, pristine)', 'initial vendor', '—']],
          ),
          '',
          '## Upstream PRs',
          '',
          ...formatMarkdownTable(['PR', 'Title', 'Commits', 'Status'], [['—', '(none yet)', '—', '—']]),
        ].join('\n'),
      );
    }

    // ── Post-conversion verification ─────────────────────────────────────
    const staleImports = this.findStaleFrontendImports(
      dest,
      (specifier) => isPackageImport(specifier, '@lenne.tech/nuxt-extensions'),
      'app/core/',
    );
    if (staleImports.length > 0) {
      const { print } = this.toolbox;
      print.warning(
        `${staleImports.length} file(s) still contain '@lenne.tech/nuxt-extensions' imports after vendor conversion:`,
      );
      for (const f of staleImports.slice(0, 10)) {
        print.info(`  ${f}`);
      }
      if (staleImports.length > 10) {
        print.info(`  ... and ${staleImports.length - 10} more`);
      }
      print.info('These imports must be manually rewritten to relative paths pointing to app/core.');
    }

    return { upstreamDeps };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private vendor helpers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Rewrite nuxt.config.ts module entry between npm and vendor mode.
   *
   * npm→vendor: '@lenne.tech/nuxt-extensions' → './app/core/module'
   * vendor→npm: './app/core/module' → '@lenne.tech/nuxt-extensions'
   */
  private rewriteNuxtConfig(appDir: string, mode: 'npm' | 'vendor'): void {
    const path = require('node:path');
    const { filesystem } = this.toolbox;
    const configPath = path.join(appDir, 'nuxt.config.ts');
    if (!filesystem.exists(configPath)) return;

    let content = filesystem.read(configPath) || '';
    if (mode === 'vendor') {
      content = content.replace(/['"]@lenne\.tech\/nuxt-extensions['"]/g, "'./app/core/module'");
    } else {
      content = content.replace(/['"]\.\/app\/core\/module['"]/g, "'@lenne.tech/nuxt-extensions'");
    }
    filesystem.write(configPath, content);
  }

  /**
   * Rewrite consumer imports from npm specifiers to relative vendor paths.
   *
   * Handles both .ts and .vue files via regex replacement.
   * Skips files inside app/core/ (the vendored framework itself).
   */
  private rewriteConsumerImportsToVendor(appDir: string): void {
    const path = require('node:path');
    const { filesystem } = this.toolbox;

    const coreDir = path.join(appDir, 'app', 'core');
    const coreDirWithSep = coreDir + path.sep;
    const allFiles = this.walkConsumerFiles(appDir);

    for (const absFile of allFiles) {
      // Skip vendored framework files
      if (absFile.startsWith(coreDirWithSep)) continue;

      const content = filesystem.read(absFile);
      if (!content) continue;
      if (!content.includes('@lenne.tech/nuxt-extensions')) continue;

      const fromDir = path.dirname(absFile);
      let relToCore = path.relative(fromDir, coreDir).split(path.sep).join('/');
      if (!relToCore.startsWith('.')) relToCore = `./${relToCore}`;

      let patched = content;
      // Testing imports: @lenne.tech/nuxt-extensions/testing → relative/runtime/testing
      patched = patched.replace(
        /from\s+['"]@lenne\.tech\/nuxt-extensions\/testing['"]/g,
        `from '${relToCore}/runtime/testing'`,
      );
      // Main imports: @lenne.tech/nuxt-extensions → relative core
      patched = patched.replace(/from\s+['"]@lenne\.tech\/nuxt-extensions['"]/g, `from '${relToCore}'`);

      if (patched !== content) {
        filesystem.write(absFile, patched);
      }
    }
  }

  /**
   * Rewrite consumer imports from relative vendor paths back to npm specifiers.
   */
  private rewriteConsumerImportsToNpm(appDir: string): void {
    const path = require('node:path');
    const { filesystem } = this.toolbox;

    const coreDir = path.join(appDir, 'app', 'core');
    const coreDirWithSep = coreDir + path.sep;
    const allFiles = this.walkConsumerFiles(appDir);

    for (const absFile of allFiles) {
      if (absFile.startsWith(coreDirWithSep)) continue;

      const content = filesystem.read(absFile);
      if (!content) continue;

      // Check if file has any relative import pointing to the core dir
      const fromDir = path.dirname(absFile);
      const relToCore = path.relative(fromDir, coreDir).split(path.sep).join('/');
      if (!content.includes(relToCore)) continue;

      let patched = content;
      // Testing imports: relative/runtime/testing → @lenne.tech/nuxt-extensions/testing
      const testingPattern = new RegExp(
        `from\\s+['"]${relToCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/runtime/testing['"]`,
        'g',
      );
      patched = patched.replace(testingPattern, "from '@lenne.tech/nuxt-extensions/testing'");
      // Main imports: relative core → @lenne.tech/nuxt-extensions
      const corePattern = new RegExp(`from\\s+['"]${relToCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');
      patched = patched.replace(corePattern, "from '@lenne.tech/nuxt-extensions'");

      if (patched !== content) {
        filesystem.write(absFile, patched);
      }
    }
  }

  /**
   * Scan consumer files for stale imports matching a pattern.
   */
  private findStaleFrontendImports(
    appDir: string,
    matches: (specifier: string) => boolean,
    skipPathContaining?: string,
  ): string[] {
    const { filesystem } = this.toolbox;
    const allFiles = this.walkConsumerFiles(appDir);
    const stale: string[] = [];

    for (const absFile of allFiles) {
      if (skipPathContaining && absFile.includes(skipPathContaining)) continue;
      // Ask the parser for the file's module specifiers instead of searching its text.
      // A docblock that DOCUMENTS the conversion quotes the very import syntax a text
      // search looks for, and blanking comments first does not hold either — see
      // src/lib/module-specifiers.ts. A comment is not part of the AST, so the whole
      // false-positive class is gone rather than worked around.
      const specifiers = fileImportedSpecifiers(absFile, (path) => filesystem.read(path) || undefined);
      if (specifiers.some(matches)) {
        stale.push(absFile.replace(`${appDir}/`, ''));
      }
    }
    return stale;
  }

  /**
   * Cached set of upstream @lenne.tech/nuxt-extensions devDeps that are
   * actually runtime-needed after vendoring. Populated lazily from
   * `src/config/vendor-frontend-runtime-deps.json` so new helpers can be
   * added without touching this file.
   */
  private _vendorFrontendRuntimeHelpers?: Set<string>;

  /**
   * Predicate: is a given upstream `devDependencies` key actually a runtime
   * dep in disguise that needs to live in `dependencies` after vendoring?
   *
   * The list of such helpers lives in `src/config/vendor-frontend-runtime-deps.json`
   * under the `runtimeHelpers` key. Adding a new helper is a data-only change
   * (no CLI release required). If the config file is missing or unreadable,
   * the predicate safely returns `false` for everything.
   *
   * Currently, nuxt-extensions has a minimal dependency graph (only `@nuxt/kit`
   * as a direct runtime dep), so this list is typically empty. The mechanism
   * exists for future-proofing: if upstream adds a devDep that the framework
   * code imports at runtime, add it to the JSON and the next vendor conversion
   * will promote it automatically.
   */
  protected isFrontendVendorRuntimeDep(pkgName: string): boolean {
    if (!this._vendorFrontendRuntimeHelpers) {
      try {
        const path = require('node:path');
        const configPath = path.join(__dirname, '..', 'config', 'vendor-frontend-runtime-deps.json');
        const raw = this.toolbox.filesystem.read(configPath, 'json') as undefined | { runtimeHelpers?: string[] };
        const list = Array.isArray(raw?.runtimeHelpers) ? raw!.runtimeHelpers : [];
        this._vendorFrontendRuntimeHelpers = new Set(list.filter((e) => typeof e === 'string'));
      } catch {
        this._vendorFrontendRuntimeHelpers = new Set();
      }
    }
    return this._vendorFrontendRuntimeHelpers.has(pkgName);
  }

  /**
   * Recursively walks `app/` and `tests/` directories under `appDir`,
   * returning absolute paths to all `.ts` and `.vue` files.
   *
   * Shared helper for consumer-import codemods and stale-import scans.
   * Uses native `fs.readdirSync` because gluegun's `filesystem.find()`
   * returns paths relative to the jetpack cwd, which is unreliable
   * when the CLI is invoked from arbitrary working directories.
   */
  private walkConsumerFiles(appDir: string): string[] {
    const fs = require('node:fs');
    const path = require('node:path');

    const searchDirs = [path.join(appDir, 'app'), path.join(appDir, 'tests')];
    const allFiles: string[] = [];

    const walk = (dir: string): void => {
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const fp = path.join(dir, item.name);
          if (item.isDirectory()) {
            walk(fp);
          } else if (item.isFile() && (fp.endsWith('.ts') || fp.endsWith('.vue'))) {
            allFiles.push(fp);
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    };

    for (const dir of searchDirs) {
      walk(dir);
    }
    return allFiles;
  }

  /**
   * Parse markdown content into H2 sections for section-level merge.
   */
  private parseH2Sections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const lines = content.split('\n');
    let currentHeading = '__preamble__';
    let currentBody: string[] = [];

    for (const line of lines) {
      const match = /^## (.+)$/.exec(line);
      if (match) {
        sections.set(currentHeading, currentBody.join('\n'));
        currentHeading = match[1].trim();
        currentBody = [];
      } else {
        currentBody.push(line);
      }
    }
    sections.set(currentHeading, currentBody.join('\n'));
    return sections;
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.frontendHelper = new FrontendHelper(toolbox);
};
