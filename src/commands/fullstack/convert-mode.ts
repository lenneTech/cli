import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { detectFrameworkMode } from '../../lib/framework-detection';
import { detectFrontendFrameworkMode } from '../../lib/frontend-framework-detection';

/**
 * Convert both backend and frontend of a fullstack monorepo between
 * npm mode and vendor mode in a single command.
 *
 * Usage:
 *   lt fullstack convert-mode --to vendor [--framework-upstream-branch 11.24.3] [--frontend-framework-upstream-branch 1.5.3]
 *   lt fullstack convert-mode --to npm
 *   lt fullstack convert-mode --to vendor --skip-frontend
 *   lt fullstack convert-mode --to vendor --skip-backend
 *   lt fullstack convert-mode --to vendor --dry-run
 *
 * Orchestrates `lt server convert-mode` + `lt frontend convert-mode` with
 * auto-detection of `projects/api/` and `projects/app/` subdirectories.
 */
const ConvertModeCommand: GluegunCommand = {
  description: 'Convert fullstack monorepo between npm and vendor modes',
  hidden: false,
  name: 'convert-mode',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      frontendHelper,
      parameters,
      print: { colors, error, info, spin, success, warning },
      prompt: { confirm },
      server,
    } = toolbox;

    // Handle --help-json flag
    if (
      toolbox.tools.helpJson({
        description: 'Convert fullstack monorepo (backend + frontend) between npm and vendor modes',
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
            description: 'Backend upstream branch/tag (only with --to vendor, e.g. "11.24.3")',
            flag: '--framework-upstream-branch',
            required: false,
            type: 'string',
          },
          {
            description: 'Frontend upstream branch/tag (only with --to vendor, e.g. "1.5.3")',
            flag: '--frontend-framework-upstream-branch',
            required: false,
            type: 'string',
          },
          {
            description: 'Backend version to install (only with --to npm, default: from VENDOR.md baseline)',
            flag: '--framework-version',
            required: false,
            type: 'string',
          },
          {
            description: 'Frontend version to install (only with --to npm, default: from VENDOR.md baseline)',
            flag: '--frontend-framework-version',
            required: false,
            type: 'string',
          },
          {
            default: false,
            description: 'Skip backend conversion',
            flag: '--skip-backend',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Skip frontend conversion',
            flag: '--skip-frontend',
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
          {
            default: false,
            description: 'Skip confirmation prompt',
            flag: '--noConfirm',
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

    const skipBackend = parameters.options['skip-backend'] === true || parameters.options['skip-backend'] === 'true';
    const skipFrontend = parameters.options['skip-frontend'] === true || parameters.options['skip-frontend'] === 'true';
    const dryRun = parameters.options['dry-run'] === true || parameters.options['dry-run'] === 'true';
    const noConfirm = parameters.options.noConfirm === true || parameters.options.noConfirm === 'true';

    if (skipBackend && skipFrontend) {
      error('Cannot skip both backend and frontend — nothing would happen.');
      return;
    }

    // Locate the subprojects. Typical monorepo layouts: projects/{api,app} or packages/{api,app}.
    const cwd = filesystem.cwd();
    const backendCandidates = [join(cwd, 'projects', 'api'), join(cwd, 'packages', 'api')];
    const frontendCandidates = [join(cwd, 'projects', 'app'), join(cwd, 'packages', 'app')];

    let backendDir: string | undefined;
    for (const candidate of backendCandidates) {
      if (filesystem.exists(join(candidate, 'package.json'))) {
        backendDir = candidate;
        break;
      }
    }

    let frontendDir: string | undefined;
    for (const candidate of frontendCandidates) {
      if (filesystem.exists(join(candidate, 'package.json'))) {
        frontendDir = candidate;
        break;
      }
    }

    if (!backendDir && !frontendDir) {
      error(
        'Could not find any api or app subproject. Expected projects/api, projects/app, packages/api, or packages/app.',
      );
      return;
    }

    // Detect current modes
    const backendCurrentMode = backendDir ? detectFrameworkMode(backendDir) : null;
    const frontendCurrentMode = frontendDir ? detectFrontendFrameworkMode(frontendDir) : null;

    // Decide what will actually happen
    const willConvertBackend = !skipBackend && backendDir && backendCurrentMode && backendCurrentMode !== targetMode;
    const willConvertFrontend =
      !skipFrontend && frontendDir && frontendCurrentMode && frontendCurrentMode !== targetMode;

    // ── Plan output ─────────────────────────────────────────────────────
    info('');
    info(colors.bold('Fullstack convert-mode plan:'));
    info(colors.dim('─'.repeat(60)));

    if (backendDir) {
      const backendLabel = skipBackend
        ? colors.yellow('(skipped via --skip-backend)')
        : backendCurrentMode === targetMode
          ? colors.dim(`(already in ${targetMode} mode — nothing to do)`)
          : colors.green(`${backendCurrentMode} → ${targetMode}`);
      info(`  Backend:  ${backendDir}`);
      info(`            ${backendLabel}`);
    } else {
      info(`  Backend:  ${colors.dim('(not found)')}`);
    }

    if (frontendDir) {
      const frontendLabel = skipFrontend
        ? colors.yellow('(skipped via --skip-frontend)')
        : frontendCurrentMode === targetMode
          ? colors.dim(`(already in ${targetMode} mode — nothing to do)`)
          : colors.green(`${frontendCurrentMode} → ${targetMode}`);
      info(`  Frontend: ${frontendDir}`);
      info(`            ${frontendLabel}`);
    } else {
      info(`  Frontend: ${colors.dim('(not found)')}`);
    }

    info(colors.dim('─'.repeat(60)));

    if (!willConvertBackend && !willConvertFrontend) {
      info('');
      warning('Nothing to do: both subprojects are already in the target mode (or skipped).');
      return;
    }

    if (dryRun) {
      info('');
      info(colors.bold('Would execute:'));
      if (willConvertBackend) {
        if (targetMode === 'vendor') {
          const branch = parameters.options['framework-upstream-branch'] || '(auto-detect from package.json)';
          info(`  [Backend]  lt server convert-mode --to vendor --upstream-branch ${branch} --noConfirm`);
        } else {
          const version = parameters.options['framework-version'] || '(from VENDOR.md baseline)';
          info(`  [Backend]  lt server convert-mode --to npm --version ${version} --noConfirm`);
        }
      }
      if (willConvertFrontend) {
        if (targetMode === 'vendor') {
          const branch = parameters.options['frontend-framework-upstream-branch'] || '(auto-detect from package.json)';
          info(`  [Frontend] lt frontend convert-mode --to vendor --upstream-branch ${branch} --noConfirm`);
        } else {
          const version = parameters.options['frontend-framework-version'] || '(from VENDOR.md baseline)';
          info(`  [Frontend] lt frontend convert-mode --to npm --version ${version} --noConfirm`);
        }
      }
      info('');
      return `fullstack convert-mode dry-run (target: ${targetMode})`;
    }

    // ── Confirmation ────────────────────────────────────────────────────
    if (!noConfirm) {
      info('');
      const proceed = await confirm(
        `Convert ${[willConvertBackend && 'backend', willConvertFrontend && 'frontend'].filter(Boolean).join(' + ')} to ${targetMode} mode?`,
      );
      if (!proceed) {
        info('Aborted.');
        return;
      }
    }

    // ── Execute ─────────────────────────────────────────────────────────
    const results: { message?: string; part: string; status: 'failed' | 'ok' | 'skipped' }[] = [];

    // 1. Backend conversion
    if (willConvertBackend && backendDir) {
      info('');
      info(colors.bold(`[1/2] Backend: ${backendCurrentMode} → ${targetMode}`));

      if (targetMode === 'vendor') {
        let branch = parameters.options['framework-upstream-branch'] as string | undefined;
        // Auto-detect version from package.json if not provided
        if (!branch) {
          try {
            const pkg = filesystem.read(`${backendDir}/package.json`, 'json') as Record<string, any>;
            const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
            const version = deps['@lenne.tech/nest-server'];
            if (version) {
              branch = version.replace(/^[^0-9]*/, '');
              info(`  Auto-detected @lenne.tech/nest-server version: ${branch}`);
            }
          } catch {
            // Will use HEAD
          }
        }

        const spinner = spin('  Converting backend to vendor mode...');
        try {
          await server.convertToVendorMode({
            dest: backendDir,
            upstreamBranch: branch,
          });
          spinner.succeed('  Backend converted to vendor mode');
          results.push({ part: 'backend', status: 'ok' });
        } catch (err) {
          spinner.fail(`  Backend conversion failed: ${(err as Error).message}`);
          results.push({ message: (err as Error).message, part: 'backend', status: 'failed' });
        }
      } else {
        const targetVersion = parameters.options['framework-version'] as string | undefined;
        const spinner = spin('  Converting backend to npm mode...');
        try {
          await server.convertToNpmMode({
            dest: backendDir,
            targetVersion,
          });
          spinner.succeed('  Backend converted to npm mode');
          results.push({ part: 'backend', status: 'ok' });
        } catch (err) {
          spinner.fail(`  Backend conversion failed: ${(err as Error).message}`);
          results.push({ message: (err as Error).message, part: 'backend', status: 'failed' });
        }
      }
    } else if (backendDir) {
      const reason = skipBackend ? 'skipped via flag' : `already in ${targetMode} mode`;
      info('');
      info(colors.dim(`[1/2] Backend: ${reason}`));
      results.push({ message: reason, part: 'backend', status: 'skipped' });
    }

    // 2. Frontend conversion
    if (willConvertFrontend && frontendDir) {
      info('');
      info(colors.bold(`[2/2] Frontend: ${frontendCurrentMode} → ${targetMode}`));

      if (targetMode === 'vendor') {
        let branch = parameters.options['frontend-framework-upstream-branch'] as string | undefined;
        if (!branch) {
          try {
            const pkg = filesystem.read(`${frontendDir}/package.json`, 'json') as Record<string, any>;
            const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
            const version = deps['@lenne.tech/nuxt-extensions'];
            if (version) {
              branch = version.replace(/^[^0-9]*/, '');
              info(`  Auto-detected @lenne.tech/nuxt-extensions version: ${branch}`);
            }
          } catch {
            // Will use HEAD
          }
        }

        const spinner = spin('  Converting frontend to vendor mode...');
        try {
          await frontendHelper.convertAppToVendorMode({
            dest: frontendDir,
            upstreamBranch: branch,
          });
          spinner.succeed('  Frontend converted to vendor mode');
          results.push({ part: 'frontend', status: 'ok' });
        } catch (err) {
          spinner.fail(`  Frontend conversion failed: ${(err as Error).message}`);
          results.push({ message: (err as Error).message, part: 'frontend', status: 'failed' });
        }
      } else {
        const targetVersion = parameters.options['frontend-framework-version'] as string | undefined;
        const spinner = spin('  Converting frontend to npm mode...');
        try {
          await frontendHelper.convertAppToNpmMode({
            dest: frontendDir,
            targetVersion,
          });
          spinner.succeed('  Frontend converted to npm mode');
          results.push({ part: 'frontend', status: 'ok' });
        } catch (err) {
          spinner.fail(`  Frontend conversion failed: ${(err as Error).message}`);
          results.push({ message: (err as Error).message, part: 'frontend', status: 'failed' });
        }
      }
    } else if (frontendDir) {
      const reason = skipFrontend ? 'skipped via flag' : `already in ${targetMode} mode`;
      info('');
      info(colors.dim(`[2/2] Frontend: ${reason}`));
      results.push({ message: reason, part: 'frontend', status: 'skipped' });
    }

    // ── Summary ─────────────────────────────────────────────────────────
    info('');
    info(colors.bold('Summary:'));
    info(colors.dim('─'.repeat(60)));
    for (const result of results) {
      const icon =
        result.status === 'ok' ? colors.green('✓') : result.status === 'skipped' ? colors.dim('–') : colors.red('✗');
      const label = result.part.padEnd(10);
      info(`  ${icon}  ${label} ${result.message || result.status}`);
    }
    info(colors.dim('─'.repeat(60)));

    const failed = results.filter((r) => r.status === 'failed');
    if (failed.length > 0) {
      info('');
      error(`${failed.length} conversion(s) failed. See messages above.`);
      if (!parameters.options.fromGluegunMenu) {
        process.exit(1);
      }
      return `fullstack convert-mode failed (${failed.length} error(s))`;
    }

    info('');
    success('All conversions completed successfully.');
    info('');
    info(colors.bold('Next steps:'));
    info('  1. Run: pnpm install  (from monorepo root)');
    if (backendDir && results.find((r) => r.part === 'backend' && r.status === 'ok')) {
      info('  2. Verify backend:   cd projects/api && pnpm exec tsc --noEmit && pnpm test');
    }
    if (frontendDir && results.find((r) => r.part === 'frontend' && r.status === 'ok')) {
      info('  3. Verify frontend:  cd projects/app && pnpm run build');
    }
    info('  4. Commit the changes');
    info('');

    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `fullstack convert-mode completed (target: ${targetMode})`;
  },
};

export default ConvertModeCommand;
