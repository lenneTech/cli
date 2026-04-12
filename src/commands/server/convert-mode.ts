import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { detectFrameworkMode, findProjectDir } from '../../lib/framework-detection';

/**
 * Convert an existing API project between npm mode and vendor mode.
 *
 * Usage:
 *   lt server convert-mode --to vendor [--upstream-branch 11.24.2]
 *   lt server convert-mode --to npm [--version 11.24.2]
 */
const ConvertModeCommand: GluegunCommand = {
  description: 'Convert API project between npm and vendor framework modes',
  hidden: false,
  name: 'convert-mode',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { error, info, spin, success, warning },
      prompt: { confirm },
      server,
    } = toolbox;

    // Handle --help-json flag
    if (
      toolbox.tools.helpJson({
        description: 'Convert API project between npm and vendor framework modes',
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
            description: 'nest-server version to install (only with --to npm, default: from VENDOR.md baseline)',
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

    // Find the API project root
    const cwd = filesystem.cwd();
    const projectDir = findProjectDir(cwd);
    if (!projectDir) {
      error('Could not find a package.json in the current directory or any parent. Are you inside an API project?');
      return;
    }

    // Detect current mode
    const currentMode = detectFrameworkMode(projectDir);
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
      info(`  projectDir:   ${projectDir}`);
      info(`  currentMode:  ${currentMode}`);
      info(`  targetMode:   ${targetMode}`);
      if (targetMode === 'vendor') {
        const upstreamBranch = parameters.options['upstream-branch'] as string | undefined;
        info(`  upstreamBranch: ${upstreamBranch || '(auto-detect from package.json)'}`);
        info('');
        info('Would execute:');
        info('  1. Clone @lenne.tech/nest-server → /tmp/lt-vendor-nest-server-*');
        info('  2. Copy src/core/, src/index.ts, src/core.module.ts, test/, templates/, types/ → src/core/');
        info('  3. Apply flatten-fix (index.ts, core.module.ts, test.helper.ts)');
        info('  4. Rewrite consumer imports: @lenne.tech/nest-server → relative paths');
        info('  5. Merge upstream deps dynamically into package.json');
        info('  6. Rewrite migrate scripts to use local bin/migrate.js');
        info('  7. Add check:vendor-freshness script');
        info('  8. Create src/core/VENDOR.md with baseline metadata');
        info('  9. Prepend vendor-mode notice to CLAUDE.md');
      } else {
        const targetVersion = parameters.options.version as string | undefined;
        info(`  targetVersion: ${targetVersion || '(from VENDOR.md baseline)'}`);
        info('');
        info('Would execute:');
        info('  1. Read baseline version from src/core/VENDOR.md');
        info('  2. Warn if local patches exist in VENDOR.md');
        info('  3. Rewrite consumer imports: relative → @lenne.tech/nest-server');
        info('  4. Delete src/core/');
        info('  5. Restore @lenne.tech/nest-server in package.json');
        info('  6. Restore migrate scripts to node_modules paths');
        info('  7. Remove vendor artifacts and CLAUDE.md marker');
      }
      info('');
      return `server convert-mode dry-run (${currentMode} → ${targetMode})`;
    }

    // Confirm
    const noConfirm = parameters.options.noConfirm;
    if (!noConfirm) {
      const proceed = await confirm(
        `Convert project from ${currentMode} mode to ${targetMode} mode?\n` +
        `  Project: ${projectDir}\n` +
        `  This will modify package.json, imports, tsconfig, and CLAUDE.md.`,
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

      // Auto-detect version from current @lenne.tech/nest-server dep
      let branch = upstreamBranch;
      if (!branch) {
        try {
          const pkg = filesystem.read(`${projectDir}/package.json`, 'json') as Record<string, any>;
          const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
          const version = deps['@lenne.tech/nest-server'];
          if (version) {
            // Strip semver range chars (^, ~, >=, etc.) to get the bare version
            branch = version.replace(/^[^0-9]*/, '');
            info(`Auto-detected @lenne.tech/nest-server version: ${branch}`);
          }
        } catch {
          // Will prompt or use HEAD
        }
      }

      const spinner = spin('Converting to vendor mode...');
      try {
        await server.convertToVendorMode({
          dest: projectDir,
          upstreamBranch: branch,
        });
        spinner.succeed('Converted to vendor mode successfully.');
        success('\nNext steps:');
        info('  1. Run: pnpm install');
        info('  2. Run: pnpm exec tsc --noEmit');
        info('  3. Run: pnpm test');
        info('  4. Commit the changes');
      } catch (err) {
        spinner.fail(`Conversion failed: ${(err as Error).message}`);
      }
    } else {
      // vendor → npm
      const targetVersion = parameters.options.version as string | undefined;

      const spinner = spin('Converting to npm mode...');
      try {
        await server.convertToNpmMode({
          dest: projectDir,
          targetVersion,
        });
        spinner.succeed('Converted to npm mode successfully.');
        success('\nNext steps:');
        info('  1. Run: pnpm install');
        info('  2. Run: pnpm exec tsc --noEmit');
        info('  3. Run: pnpm test');
        info('  4. Commit the changes');
      } catch (err) {
        spinner.fail(`Conversion failed: ${(err as Error).message}`);
      }
    }
  },
};

export default ConvertModeCommand;
