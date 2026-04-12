import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * Options for Angular frontend setup
 */
export interface AngularSetupOptions {
  branch?: string;
  copyPath?: string;
  gitLink?: string;
  linkPath?: string;
  localize?: boolean;
  skipGitInit?: boolean;
  skipHuskyRemoval?: boolean;
  skipInstall?: boolean;
}

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
   * Fix package name in package.json
   * Changes the name to "app" which is a valid npm package name for monorepos
   *
   * @param dest - Directory containing the package.json
   */
  private async fixPackageName(dest: string): Promise<void> {
    const { patching } = this.toolbox;
    await patching.update(`${dest}/package.json`, (data: Record<string, unknown>) => {
      data.name = 'app';
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

    // Replace NUXT_PUBLIC_STORAGE_PREFIX value with project-specific prefix
    content = content.replace(/^(NUXT_PUBLIC_STORAGE_PREFIX=).*$/m, `$1${projectName}-local`);

    filesystem.write(envPath, content);
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

    // Use template extension for link/copy/branch operations
    if (linkPath || copyPath || branch) {
      const result = await templateHelper.setup(dest, {
        branch,
        copyPath,
        isNuxt: true,
        linkPath,
        repoUrl: branch ? 'https://github.com/lenneTech/nuxt-base-starter.git' : undefined,
      });

      if (!result.success) {
        return { method: result.method, path: result.path, success: false };
      }

      // Run install if not skipped and not a symlink
      if (!skipInstall && result.method !== 'link') {
        try {
          const { pm } = this.toolbox;
          await system.run(`cd "${dest}" && ${pm.install(pm.detect(dest))}`);
        } catch (err) {
          return { method: result.method, path: dest, success: false };
        }
      }

      return { method: result.method, path: result.path, success: true };
    }

    // Default: use create-nuxt-base
    try {
      const { pm } = this.toolbox;
      await system.run(pm.exec(`create-nuxt-base@latest "${dest}"`));

      // Fix package name - create-nuxt-base uses path as name which is invalid for lerna
      await this.fixPackageName(dest);

      return { method: 'npx', path: dest, success: true };
    } catch (err) {
      return { method: 'npx', path: dest, success: false };
    }
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

    // Install packages
    if (!skipInstall) {
      try {
        const { pm } = this.toolbox;
        await system.run(`cd "${dest}" && ${pm.install(pm.detect(dest))}`);
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Initialize git
    if (!skipGitInit) {
      try {
        await system.run(`cd "${dest}" && git init --initial-branch=main`);
        if (gitLink) {
          await system.run(`cd "${dest}" && git remote add origin ${gitLink}`);
          await system.run(`cd "${dest}" && git add .`);
          await system.run(`cd "${dest}" && git commit -m "Initial commit"`);
          await system.run(`cd "${dest}" && git push -u origin main`);
        }
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Remove husky
    if (!skipHuskyRemoval) {
      filesystem.remove(`${dest}/.husky`);
      await patching.update(`${dest}/package.json`, (data: Record<string, unknown>) => {
        if (data.scripts && typeof data.scripts === 'object') {
          delete (data.scripts as Record<string, unknown>).prepare;
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
        await system.run(`cd "${dest}" && ng add @angular/localize --skip-confirmation`);
      } catch {
        // Localize failure is not fatal
      }
    }

    // Run init script if exists
    if (!skipInstall) {
      try {
        const { pm: pmHelper } = this.toolbox;
        await system.run(`cd "${dest}" && ${pmHelper.run('init', pmHelper.detect(dest))}`);
      } catch {
        // Init script failure is not fatal
      }
    }

    return { method: result.method, path: dest, success: true };
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
    const { isVendoredAppProject } = require('../lib/frontend-framework-detection');

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
  async convertAppToNpmMode(options: {
    dest: string;
    targetVersion?: string;
  }): Promise<void> {
    const { dest, targetVersion } = options;
    const { filesystem } = this.toolbox;
    const path = require('node:path');

    const { isVendoredAppProject } = require('../lib/frontend-framework-detection');

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
      throw new Error(
        'Cannot determine target version. Specify --version or ensure VENDOR.md has a Baseline-Version.',
      );
    }

    // Warn if VENDOR.md documents local patches that will be lost
    const localChangesSection = vendorMd.match(/## Local changes[\s\S]*?(?=## |$)/i);
    if (localChangesSection) {
      const hasRealPatches = localChangesSection[0].includes('|') &&
        !localChangesSection[0].includes('(none, pristine)') &&
        /\|\s*\d{4}-/.test(localChangesSection[0]);
      if (hasRealPatches) {
        const { print } = this.toolbox;
        print.warning('');
        print.warning('VENDOR.md documents local patches in app/core/ that will be LOST:');
        const rows = localChangesSection[0]
          .split('\n')
          .filter((l: string) => /^\|\s*\d{4}-/.test(l));
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
        (pkg.dependencies as Record<string, string>)['@lenne.tech/nuxt-extensions'] = `^${version}`;

        // Remove vendor-specific scripts
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          const scripts = pkg.scripts as Record<string, string>;
          delete scripts['check:vendor-freshness'];
          // Unhook freshness from check/check:fix/check:naf
          for (const scriptName of ['check', 'check:fix', 'check:naf']) {
            if (scripts[scriptName]?.includes('check:vendor-freshness')) {
              scripts[scriptName] = scripts[scriptName]
                .replace(/pnpm run check:vendor-freshness && /g, '');
            }
          }
        }

        filesystem.write(pkgPath, pkg, { jsonIndent: 2 });
      }
    }

    // ── 5. Rewrite nuxt.config.ts module entry ──────────────────────────
    this.rewriteNuxtConfig(dest, 'npm');

    // ── 6. Clean CLAUDE.md vendor marker ─────────────────────────────────
    const claudeMdPath = path.join(dest, 'CLAUDE.md');
    if (filesystem.exists(claudeMdPath)) {
      let content = filesystem.read(claudeMdPath) || '';
      const markerStart = '<!-- lt-vendor-marker-frontend -->';
      const markerEnd = '---';
      if (content.includes(markerStart)) {
        const startIdx = content.indexOf(markerStart);
        const endIdx = content.indexOf(markerEnd, startIdx);
        if (endIdx > startIdx) {
          content = content.slice(0, startIdx) + content.slice(endIdx + markerEnd.length);
          content = content.replace(/^\n+/, '');
          filesystem.write(claudeMdPath, content);
        }
      }
    }

    // ── Post-conversion verification ─────────────────────────────────────
    const stale = this.findStaleFrontendImports(dest, /from\s+['"]\..*\/core['"]/);
    if (stale.length > 0) {
      const { print } = this.toolbox;
      print.warning(
        `${stale.length} file(s) still contain relative core imports after npm conversion:`,
      );
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
    const {
      dest,
      upstreamBranch,
      upstreamRepoUrl = 'https://github.com/lenneTech/nuxt-extensions.git',
    } = options;

    const path = require('node:path');
    const { filesystem, system } = this.toolbox;
    const coreDir = path.join(dest, 'app', 'core');

    // ── 1. Clone @lenne.tech/nuxt-extensions into temp dir ──────────────
    const tmpClone = path.join(require('os').tmpdir(), `lt-vendor-nuxt-ext-${Date.now()}`);
    const branchArg = upstreamBranch ? `--branch ${upstreamBranch} ` : '';
    try {
      await system.run(`git clone --depth 1 ${branchArg}${upstreamRepoUrl} ${tmpClone}`);
    } catch (err) {
      const raw = (err as Error).message || '';
      const hints: string[] = [];
      if (/Could not resolve host|getaddrinfo|ECONNREFUSED|Network is unreachable/i.test(raw)) {
        hints.push('Network issue reaching github.com — check your connection or proxy settings.');
      }
      if (/Permission denied|authentication failed|publickey|403|401/i.test(raw)) {
        hints.push('Authentication issue — the CLI uses an anonymous HTTPS clone; verify GitHub is reachable.');
      }
      if (upstreamBranch && /Remote branch .* not found|did not match any file\(s\) known to git/i.test(raw)) {
        hints.push(
          `Upstream ref "${upstreamBranch}" does not exist. Check ${upstreamRepoUrl}/tags for valid refs. ` +
          'Note: nuxt-extensions tags have NO "v" prefix — use e.g. "1.5.3", not "v1.5.3".',
        );
      }
      if (/already exists and is not an empty/i.test(raw)) {
        hints.push(`Target ${tmpClone} already exists. rm -rf /tmp/lt-vendor-nuxt-ext-* and retry.`);
      }
      const hintBlock = hints.length > 0 ? `\n  Hints:\n    - ${hints.join('\n    - ')}` : '';
      throw new Error(
        `Failed to clone ${upstreamRepoUrl}${upstreamBranch ? ` (branch/tag: ${upstreamBranch})` : ''}.\n  Raw git error: ${raw.trim()}${hintBlock}`,
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
      const sha = await system.run(`git -C ${tmpClone} rev-parse HEAD`);
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
            'if(!m){process.stderr.write(String.fromCharCode(9888)+\' vendor-freshness: no baseline\\n\');process.exit(0)}',
            'var v=m[1];',
            "h.get('https://registry.npmjs.org/@lenne.tech/nuxt-extensions/latest',function(r){",
            "var d='';r.on('data',function(c){d+=c});r.on('end',function(){",
            "try{var l=JSON.parse(d).version;",
            "if(v===l)console.log('vendor core up-to-date (v'+v+')');",
            "else process.stderr.write('vendor core v'+v+', latest v'+l+'\\n')",
            '}catch(e){}})}).on(\'error\',function(){});',
            'setTimeout(function(){process.exit(0)},5000)',
            '"',
          ].join('');

          // Hook freshness into check scripts
          const hookFreshness = (scriptName: string) => {
            const existing = scripts[scriptName];
            if (!existing) return;
            if (existing.includes('check:vendor-freshness')) return;
            scripts[scriptName] = `pnpm run check:vendor-freshness && ${existing}`;
          };
          hookFreshness('check');
          hookFreshness('check:fix');
          hookFreshness('check:naf');
        }

        filesystem.write(pkgPath, pkg, { jsonIndent: 2 });
      }
    }

    // ── 6. CLAUDE.md: prepend vendor marker + merge upstream sections ────
    const claudeMdPath = path.join(dest, 'CLAUDE.md');
    if (filesystem.exists(claudeMdPath)) {
      const existing = filesystem.read(claudeMdPath) || '';
      const marker = '<!-- lt-vendor-marker-frontend -->';
      if (!existing.includes(marker)) {
        const vendorBlock = [
          marker,
          '',
          '# Vendor-Mode Notice (Frontend)',
          '',
          'This frontend project runs in **vendor mode**: the `@lenne.tech/nuxt-extensions`',
          'module has been copied directly into `app/core/` as first-class',
          'project code. There is **no** `@lenne.tech/nuxt-extensions` npm dependency.',
          '',
          '- **Read framework code from `app/core/**`** — not from `node_modules/`.',
          '- **nuxt.config.ts** references `\'./app/core/module\'` instead of',
          '  `\'@lenne.tech/nuxt-extensions\'`.',
          '- **Baseline + patch log** live in `app/core/VENDOR.md`. Log any',
          '  substantial local change there so the `nuxt-extensions-core-updater`',
          '  agent can classify it at sync time.',
          '- **Update flow:** run `/lt-dev:frontend:update-nuxt-extensions-core`.',
          '- **Contribute back:** run `/lt-dev:frontend:contribute-nuxt-extensions-core`.',
          '- **Freshness check:** `pnpm run check:vendor-freshness` warns when',
          '  upstream has a newer release than the baseline.',
          '',
          '---',
          '',
        ].join('\n');
        filesystem.write(claudeMdPath, vendorBlock + existing);
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
          'It is first-class project code, not a node_modules shadow copy.',
          'Edit freely; log substantial changes in the "Local changes" table below',
          'so the `nuxt-extensions-core-updater` agent can classify them at sync time.',
          '',
          'Unlike the backend (nest-server) vendoring, no flatten-fix is needed —',
          'the nuxt-extensions source structure is already flat.',
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
          '| Date | From | To | Notes |',
          '| ---- | ---- | -- | ----- |',
          `| ${today} | — | ${syncHistoryTo} | scaffolded by lt CLI |`,
          '',
          '## Local changes',
          '',
          '| Date | Commit | Scope | Reason | Status |',
          '| ---- | ------ | ----- | ------ | ------ |',
          '| — | — | (none, pristine) | initial vendor | — |',
          '',
          '## Upstream PRs',
          '',
          '| PR | Title | Commits | Status |',
          '| -- | ----- | ------- | ------ |',
          '| — | (none yet) | — | — |',
          '',
        ].join('\n'),
      );
    }

    // ── Post-conversion verification ─────────────────────────────────────
    // Only match actual import/from statements, not comments or strings
    const staleImports = this.findStaleFrontendImports(
      dest,
      /(?:^|\s)(?:import|from)\s+['"][^'"]*@lenne\.tech\/nuxt-extensions/m,
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
      content = content.replace(
        /['"]@lenne\.tech\/nuxt-extensions['"]/g,
        "'./app/core/module'",
      );
    } else {
      content = content.replace(
        /['"]\.\/app\/core\/module['"]/g,
        "'@lenne.tech/nuxt-extensions'",
      );
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
      patched = patched.replace(
        /from\s+['"]@lenne\.tech\/nuxt-extensions['"]/g,
        `from '${relToCore}'`,
      );

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
      const corePattern = new RegExp(
        `from\\s+['"]${relToCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
        'g',
      );
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
    needle: RegExp | string,
    skipPathContaining?: string,
  ): string[] {
    const { filesystem } = this.toolbox;
    const allFiles = this.walkConsumerFiles(appDir);
    const stale: string[] = [];

    for (const absFile of allFiles) {
      if (skipPathContaining && absFile.includes(skipPathContaining)) continue;
      const content = filesystem.read(absFile) || '';
      const matches = typeof needle === 'string'
        ? content.includes(needle)
        : needle.test(content);
      if (matches) {
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
        const raw = this.toolbox.filesystem.read(configPath, 'json') as
          | undefined
          | { runtimeHelpers?: string[] };
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

    const searchDirs = [
      path.join(appDir, 'app'),
      path.join(appDir, 'tests'),
    ];
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
