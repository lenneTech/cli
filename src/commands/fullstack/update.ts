import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { fetchCheckWrapperRelease } from '../../lib/check-wrapper-release';
import { addToGitignore } from '../../lib/dev-patches';
import { detectFrameworkMode, isVendoredProject } from '../../lib/framework-detection';
import { detectFrontendFramework } from '../../lib/frontend-kind';
import { healCheckWrapper } from '../../lib/heal-check-wrapper';
import { healDangerousOxlintFixFlags, healOxlintrcFilename } from '../../lib/heal-oxlintrc';
import { healVendorMigrateStore, healVendorTsCompiler } from '../../lib/heal-vendor-migrate-store';
import { healVendorClaudeMd } from '../../lib/vendor-claude-md';

/**
 * Update a fullstack workspace — mode-aware.
 *
 * lenne.tech fullstack projects currently run in one of two framework
 * consumption modes:
 *
 *   - npm mode:    `@lenne.tech/nest-server` is an npm dependency. Updates
 *                  happen via `pnpm update @lenne.tech/nest-server` plus
 *                  the migration guides, orchestrated by the
 *                  `lt-dev:nest-server-updater` Claude Code agent.
 *
 *   - vendor mode: The framework `core/` tree is vendored into
 *                  `projects/api/src/core/`. Updates happen via the
 *                  `lt-dev:nest-server-core-updater` Claude Code agent,
 *                  which clones the upstream repo, computes a delta,
 *                  applies the approved hunks, and re-runs the flatten-fix.
 *
 * Detection is based on the presence of `src/core/VENDOR.md` in the api
 * project. This command prints the right instructions for the caller's
 * project; actual update orchestration lives in the Claude Code agents,
 * not in the CLI.
 */
const NewCommand: GluegunCommand = {
  alias: ['up', 'upd'],
  description: 'Show the mode-specific update instructions for this fullstack workspace',
  hidden: false,
  name: 'update',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      print: { colors, info, success, warning },
    } = toolbox;

    info('');
    info(colors.bold('Fullstack Update'));
    info(colors.dim('─'.repeat(60)));

    // Walk from cwd DOWN into projects/api if it exists, otherwise assume
    // the caller is already inside an api project. Users can also point at
    // a specific directory via `--api <path>`.
    const cwd = filesystem.cwd();
    const candidates = [
      toolbox.parameters.options.api ? String(toolbox.parameters.options.api) : null,
      join(cwd, 'projects', 'api'),
      join(cwd, 'packages', 'api'),
      cwd,
    ].filter((p): p is string => Boolean(p));

    let apiDir: string | undefined;
    for (const candidate of candidates) {
      if (filesystem.exists(join(candidate, 'package.json'))) {
        apiDir = candidate;
        break;
      }
    }

    if (!apiDir) {
      warning('  Could not locate an api project (no package.json found in cwd or projects/api/).');
      info('');
      info('  Pass --api <path> to point at the api project explicitly.');
      info('');
      return;
    }

    const mode = detectFrameworkMode(apiDir);
    const vendored = isVendoredProject(apiDir);

    info(`  API project: ${apiDir}`);
    info(`  Framework mode: ${mode}${vendored ? ' (src/core/VENDOR.md present)' : ''}`);
    info('');

    if (mode === 'vendor') {
      info(colors.bold('Vendor-mode update flow:'));
      info('');
      info('  The framework core/ tree lives directly in this project at');
      info('    src/core/');
      info('  and is managed as first-class project code. Local patches are');
      info('  allowed and tracked in src/core/VENDOR.md.');
      info('');
      info(colors.bold('  Recommended update commands:'));
      info('');
      info('    1. Refresh the upstream baseline + check for new versions');
      info(`       ${colors.cyan('(run from the api project)')}`);
      info('');
      info('       /lt-dev:backend:update-nest-server-core');
      info('');
      info('    2. After the updater completes, run a freshness check:');
      info('');
      info('       pnpm run check:vendor-freshness');
      info('');
      info('    3. If local changes have become generally useful, propose');
      info('       them as upstream PRs via:');
      info('');
      info('       /lt-dev:backend:contribute-nest-server-core');
      info('');
      success('  All of these operate on src/core/ in-place; no npm dep bump.');
    } else {
      info(colors.bold('npm-mode update flow:'));
      info('');
      info('  The framework lives in node_modules/@lenne.tech/nest-server as');
      info('  a pinned npm dependency.');
      info('');
      info(colors.bold('  Recommended update commands:'));
      info('');
      info('    1. Run the nest-server-updater agent:');
      info('');
      info('       /lt-dev:backend:update-nest-server');
      info('');
      info('       (or manually: pnpm update @lenne.tech/nest-server');
      info('        and walk the migration guides)');
      info('');
      info('    2. After upgrade, run the full check suite:');
      info('');
      info('       pnpm run check');
      info('');
      success('  The nest-server-updater agent auto-detects vendor projects');
      success('  and delegates to nest-server-core-updater when VENDOR.md is present.');
    }

    // ── Frontend mode-aware instructions ──────────────────────────────
    info('');
    info(colors.dim('─'.repeat(60)));
    info('');

    // Detect frontend project
    const appCandidates = [join(cwd, 'projects', 'app'), join(cwd, 'packages', 'app')].filter((p): p is string =>
      Boolean(p),
    );

    let appDir: string | undefined;
    for (const candidate of appCandidates) {
      if (filesystem.exists(join(candidate, 'nuxt.config.ts')) || filesystem.exists(join(candidate, 'package.json'))) {
        appDir = candidate;
        break;
      }
    }

    // Nuxt (nuxt-extensions in app/core/) or Angular (ng-base in src/core/).
    const appFramework = appDir ? detectFrontendFramework(appDir) : undefined;
    const frontendMode = appFramework?.mode === 'vendor' ? 'vendor' : 'npm';
    if (appDir) {
      const angular = appFramework?.kind === 'angular';
      const coreDir = angular ? 'src/core/' : 'app/core/';

      info(`  App project: ${appDir}${appFramework ? ` (${angular ? 'Angular' : 'Nuxt'})` : ''}`);
      info(
        `  Frontend framework mode: ${frontendMode}${frontendMode === 'vendor' ? ` (${coreDir}VENDOR.md present)` : ''}`,
      );
      info('');

      if (frontendMode === 'vendor') {
        info(colors.bold('Frontend vendor-mode update flow:'));
        info('');
        info(`  The ${angular ? 'ng-base library' : 'nuxt-extensions module'} lives directly in this project at`);
        info(`    ${coreDir}`);
        info('  and is managed as first-class project code.');
        info('');
        info(colors.bold('  Recommended update commands:'));
        info('');
        info(angular ? '    /lt-dev:frontend:update-ng-base-core' : '    /lt-dev:frontend:update-nuxt-extensions-core');
        info('');
      } else {
        info(colors.bold('Frontend npm-mode update flow:'));
        info('');
        info('    /lt-dev:fullstack:update --skip-backend');
        info('');
        info(`    (or manually: pnpm update ${angular ? '@lenne.tech/ng-base' : '@lenne.tech/nuxt-extensions'})`);
        info('');
      }
    }

    // ── Self-heal: sync the vendor-mode notice blocks in all CLAUDE.md ────
    //
    // `lt fullstack update` doubles as a doc-sync: it (re)writes the vendor
    // notice blocks so pre-existing or drifted projects gain the correct
    // pointers — backend `projects/api/CLAUDE.md`, frontend
    // `projects/app/CLAUDE.md`, and the monorepo root `CLAUDE.md` (the entry
    // point Claude reads first). Idempotent: a no-op when already correct.
    const isWorkspace = apiDir !== cwd || (!!appDir && appDir !== cwd);
    const changedClaudeMd = healVendorClaudeMd(filesystem, {
      apiDir,
      appDir,
      backendVendor: mode === 'vendor',
      frontendKind: appFramework?.kind,
      frontendVendor: appFramework?.mode === 'vendor',
      workspaceRoot: isWorkspace ? cwd : undefined,
    });
    if (changedClaudeMd.length > 0) {
      info('');
      success(`  Synced vendor notice in ${changedClaudeMd.length} CLAUDE.md file(s):`);
      for (const changedPath of changedClaudeMd) {
        info(`    ${changedPath}`);
      }
    }

    // ── Self-heal: install/refresh the report-driven `check` wrapper ──────
    //
    // `lt fullstack init` ships `scripts/check.mjs` via the template clone, but
    // pre-existing projects predate it, and every lt-monorepo release brings a
    // newer one. This idempotently installs the wrapper of the newest
    // lt-monorepo release (and rewrites the root `check`/`check:raw`) when the
    // project's marker is older. No-op once current.
    //
    // Only at a workspace root: the wrapper is lt-monorepo's ROOT wrapper.
    // `projects/api` and standalone starter projects ship their own, unmarked
    // `scripts/check.mjs`, which heal reads as legacy — run from there, this
    // replaced the API's check and the starter's tests failed on its content.
    let changedCheck: string[] = [];
    let checkRelease = '';
    if (isWorkspace) {
      const { error, release } = fetchCheckWrapperRelease();
      if (release) {
        checkRelease = release.version;
        try {
          changedCheck = healCheckWrapper(cwd, release.assetPath);
        } finally {
          release.dispose();
        }
      } else {
        info('');
        warning(`  Check wrapper not compared: ${error}`);
        info('    The project keeps its wrapper. Re-run `lt fullstack update` once lt-monorepo is reachable.');
      }
    }
    if (changedCheck.length > 0) {
      info('');
      // A skip entry is NOT a success — it means the wrapper stayed on its old
      // version. Reporting the whole list through `success()` painted a refusal
      // green.
      const skipped = changedCheck.filter((entry) => entry.includes('skipped'));
      const applied = changedCheck.filter((entry) => !entry.includes('skipped'));
      if (applied.length > 0) {
        success(`  Installed/updated the check wrapper (lt-monorepo ${checkRelease}): ${applied.join(', ')}`);
        info('    `check` now serialises build/typecheck against the test suites,');
        info('    so it takes longer in wall-clock but no longer destabilises API e2e runs.');
        info('    The wrapper imports its siblings — keep them together, or `check` will not start.');
      }
      for (const entry of skipped) {
        warning(`  Check wrapper NOT updated: ${entry}`);
      }
    }

    // ── Self-heal: let oxlint actually load the app's config ───────────────
    //
    // oxlint only auto-discovers `.oxlintrc.json`; the app template shipped
    // `oxlint.json`, so its rules never applied. Runs AFTER the check wrapper
    // heal on purpose: the rename is refused while anything still passes
    // `--fix-suggestions`, which would delete console calls once the config loads.
    if (appDir) {
      const workspaceRoot = isWorkspace ? cwd : undefined;
      // 1. Strip the behaviour-changing fix flags first (the root wrapper was
      // handled above). A file it has to skip keeps blocking the rename below.
      const flags = healDangerousOxlintFixFlags(appDir, workspaceRoot);
      if (flags.changed.length > 0) {
        info('');
        success(`  Removed --fix-suggestions/--fix-dangerously from: ${flags.changed.join(', ')}`);
      }
      for (const entry of flags.skipped) {
        warning(`  Fix flag NOT removed: ${entry}`);
      }
      // 2. Rename — the gate inside re-checks every file.
      const oxlintrc = healOxlintrcFilename(appDir, workspaceRoot);
      if (oxlintrc.action === 'renamed') {
        info('');
        success(`  Renamed the oxlint config so oxlint loads it: ${oxlintrc.changed.join(', ')}`);
        info('    Its rules apply from now on — expect new lint findings on the next check.');
      } else if (oxlintrc.detail) {
        info('');
        warning(`  oxlint config NOT renamed: ${oxlintrc.detail}`);
      }
    }

    // ── Self-heal: keep `.lt-dev/` out of git ──────────────────────────────
    //
    // Newer templates ship the entry, but pre-existing projects predate it —
    // `lt dev up` then dirties `.gitignore` in every ticket worktree, which
    // used to block every `lt ticket stop` at its safety gate. Idempotent.
    if (addToGitignore(cwd, '.lt-dev/')) {
      info('');
      success('  Added `.lt-dev/` to .gitignore');
    }

    // ── Self-heal: keep the check's isolated Nuxt build dir out of git ──────
    //
    // The check wrapper pins `NUXT_BUILD_DIR=.nuxt-check` so it never writes the
    // `.nuxt/` a parked `nuxt dev` reads. Current starters already ignore it
    // (via their `.nuxt-*` glob); projects scaffolded before that glob do not,
    // and a build dir is a plausible place for a resolved runtimeConfig to be
    // committed by accident. Idempotent.
    if (addToGitignore(cwd, '.nuxt-check')) {
      success('  Added `.nuxt-check` to .gitignore');
    }

    // ── Self-heal: repair the vendor-mode migration store ──────────────────
    //
    // `migrations-utils/migrate.js` is written ONCE, at conversion time. Projects
    // converted before the template stopped requiring ts-node unconditionally keep
    // the broken file forever — it is project scaffolding, not `src/core/`, so no
    // update path ever revisits it. Those containers die with
    // `Cannot find module 'ts-node'` before applying a single migration, and stay
    // healthy while doing so, because the entrypoint degrades the failure to a
    // warning on purpose. Idempotent, and deliberately blind to stores that guard
    // the require their own way.
    const migrateStoreAsset = join(__dirname, '..', '..', 'templates', 'vendor-scripts', 'migrate-store.js');
    const changedStore = healVendorMigrateStore(apiDir, migrateStoreAsset);
    if (changedStore.length > 0) {
      info('');
      success(`  Repaired the vendor migration store: ${changedStore.join(', ')}`);
    }

    // ── Self-heal: the vendor-mode ts-node bootstrap next to the store ─────
    //
    // The ts-compiler.js earlier CLIs generated read the project's tsconfig and
    // overrode `module: commonjs` on top of it. A TypeScript 6 project on
    // `moduleResolution: nodenext` (what nest-server 12 recommends) turns that into
    // TS5110 and every migrate run fails. Replaced only when the file is exactly
    // what an earlier CLI wrote. The replacement uses the core's own SWC loader
    // from nest-server 12 on, where ts-node may no longer be installed.
    const tsCompilerAsset = join(__dirname, '..', '..', 'templates', 'vendor-scripts', 'ts-compiler.js');
    const changedTsCompiler = healVendorTsCompiler(apiDir, tsCompilerAsset);
    const tsCompilerSkipped = changedTsCompiler.filter((entry) => entry.includes('skipped'));
    const tsCompilerApplied = changedTsCompiler.filter((entry) => !entry.includes('skipped'));
    if (tsCompilerApplied.length > 0) {
      info('');
      success(`  Replaced the vendor ts-node bootstrap: ${tsCompilerApplied.join(', ')}`);
    }
    for (const entry of tsCompilerSkipped) {
      warning(`  Vendor ts-node bootstrap NOT replaced: ${entry}`);
    }

    info('');
    info(colors.bold('For a comprehensive update of everything, use:'));
    info('');
    info('    /lt-dev:fullstack:update-all');
    info('');
    info(colors.dim('─'.repeat(60)));
    info('');
    return `fullstack update (backend: ${mode}, frontend: ${appDir ? frontendMode : 'not found'})`;
  },
};

export default NewCommand;
