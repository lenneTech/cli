import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { detectFrontendFrameworkMode, findAppDir } from '../../lib/frontend-framework-detection';

/**
 * Convert an existing frontend project between npm mode and vendor mode.
 *
 * Usage:
 *   lt frontend convert-mode --to vendor [--upstream-branch 1.5.3]
 *   lt frontend convert-mode --to npm [--version 1.5.3]
 */
const ConvertModeCommand: GluegunCommand = {
  description: 'Convert app framework mode',
  hidden: false,
  name: 'convert-mode',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      frontendHelper,
      parameters,
      print: { error, info, spin, success, warning },
      prompt: { confirm },
    } = toolbox;

    // Handle --help-json flag
    if (
      toolbox.tools.helpJson({
        description: 'Convert frontend project between npm and vendor framework modes',
        name: 'convert-mode',
        options: [
          {
            description: 'Target mode',
            flag: '--to',
            required: true,
            type: 'string',
            values: ['vendor', 'npm'],
          },
          {
            description: 'Upstream branch/tag to vendor from (only with --to vendor)',
            flag: '--upstream-branch',
            required: false,
            type: 'string',
          },
          {
            description: 'nuxt-extensions version to install (only with --to npm, default: from VENDOR.md baseline)',
            flag: '--version',
            required: false,
            type: 'string',
          },
          {
            default: false,
            description: 'Skip confirmation prompt',
            flag: '--noConfirm',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Show the resolved plan without making any changes',
            flag: '--dry-run',
            required: false,
            type: 'boolean',
          },
        ],
      })
    ) {
      return;
    }

    const targetMode = parameters.options.to as 'npm' | 'vendor' | undefined;
    if (!targetMode || !['npm', 'vendor'].includes(targetMode)) {
      error('Missing or invalid --to flag. Use: --to vendor  or  --to npm');
      return;
    }

    // Find the frontend project root
    const cwd = filesystem.cwd();
    const appDir = findAppDir(cwd);
    if (!appDir) {
      error('Could not find a nuxt.config.ts in the current directory or any parent. Are you inside a Nuxt project?');
      return;
    }

    // Detect current mode
    const currentMode = detectFrontendFrameworkMode(appDir);
    info(`Detected current mode: ${currentMode}`);

    if (currentMode === targetMode) {
      warning(`Project is already in ${targetMode} mode. Nothing to do.`);
      return;
    }

    // Dry-run: print the resolved plan and exit without any disk changes.
    const dryRun = parameters.options['dry-run'] === true || parameters.options['dry-run'] === 'true';
    if (dryRun) {
      info('');
      info('Dry-run plan:');
      info(`  appDir:       ${appDir}`);
      info(`  currentMode:  ${currentMode}`);
      info(`  targetMode:   ${targetMode}`);
      if (targetMode === 'vendor') {
        const upstreamBranch = parameters.options['upstream-branch'] as string | undefined;
        info(`  upstreamBranch: ${upstreamBranch || '(auto-detect from package.json)'}`);
        info('');
        info('Would execute:');
        info('  1. Clone @lenne.tech/nuxt-extensions → /tmp/lt-vendor-nuxt-ext-*');
        info('  2. Copy src/module.ts + src/runtime/ → app/core/');
        info('  3. Rewrite nuxt.config.ts: @lenne.tech/nuxt-extensions → ./app/core/module');
        info('  4. Codemod consumer imports (app/**/*.{ts,vue}, tests/**/*.ts)');
        info('  5. Remove @lenne.tech/nuxt-extensions from package.json');
        info('  6. Add check:vendor-freshness script');
        info('  7. Create app/core/VENDOR.md with baseline metadata');
        info('  8. Prepend vendor-mode notice to CLAUDE.md');
      } else {
        const targetVersion = parameters.options.version as string | undefined;
        info(`  targetVersion: ${targetVersion || '(from VENDOR.md baseline)'}`);
        info('');
        info('Would execute:');
        info('  1. Read baseline version from app/core/VENDOR.md');
        info('  2. Warn if local patches exist in VENDOR.md');
        info('  3. Rewrite consumer imports: relative → @lenne.tech/nuxt-extensions');
        info('  4. Delete app/core/');
        info('  5. Restore @lenne.tech/nuxt-extensions in package.json');
        info('  6. Rewrite nuxt.config.ts: ./app/core/module → @lenne.tech/nuxt-extensions');
        info('  7. Remove vendor scripts and CLAUDE.md marker');
      }
      info('');
      return `frontend convert-mode dry-run (${currentMode} → ${targetMode})`;
    }

    // Confirm
    const noConfirm = parameters.options.noConfirm;
    if (!noConfirm) {
      const proceed = await confirm(
        `Convert project from ${currentMode} mode to ${targetMode} mode?\n` +
        `  Project: ${appDir}\n` +
        `  This will modify nuxt.config.ts, package.json, imports, and CLAUDE.md.`,
      );
      if (!proceed) {
        info('Aborted.');
        return;
      }
    }

    // Execute conversion
    if (targetMode === 'vendor') {
      // npm → vendor
      const upstreamBranch = parameters.options['upstream-branch'] as string | undefined;

      // Auto-detect version from current @lenne.tech/nuxt-extensions dep
      let branch = upstreamBranch;
      if (!branch) {
        try {
          const pkg = filesystem.read(`${appDir}/package.json`, 'json') as Record<string, any>;
          const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
          const version = deps['@lenne.tech/nuxt-extensions'];
          if (version) {
            // Strip semver range chars (^, ~, >=, etc.) to get the bare version
            branch = version.replace(/^[^0-9]*/, '');
            info(`Auto-detected @lenne.tech/nuxt-extensions version: ${branch}`);
          }
        } catch {
          // Will use HEAD
        }
      }

      const spinner = spin('Converting to vendor mode...');
      try {
        await frontendHelper.convertAppToVendorMode({
          dest: appDir,
          upstreamBranch: branch,
        });
        spinner.succeed('Converted to vendor mode successfully.');
        success('\nNext steps:');
        info('  1. Run: pnpm install');
        info('  2. Run: pnpm run build (or nuxt build)');
        info('  3. Commit the changes');
      } catch (err) {
        spinner.fail(`Conversion failed: ${(err as Error).message}`);
      }
    } else {
      // vendor → npm
      const targetVersion = parameters.options.version as string | undefined;

      const spinner = spin('Converting to npm mode...');
      try {
        await frontendHelper.convertAppToNpmMode({
          dest: appDir,
          targetVersion,
        });
        spinner.succeed('Converted to npm mode successfully.');
        success('\nNext steps:');
        info('  1. Run: pnpm install');
        info('  2. Run: pnpm run build (or nuxt build)');
        info('  3. Commit the changes');
      } catch (err) {
        spinner.fail(`Conversion failed: ${(err as Error).message}`);
      }
    }

    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `converted frontend to ${targetMode} mode`;
  },
};

export default ConvertModeCommand;
