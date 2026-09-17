import { GluegunCommand } from 'gluegun';
import { dirname } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { nonInteractiveGitEnv } from '../../lib/git-env';

/**
 * Environment that keeps the `git` calls below non-interactive.
 *
 * This used to be a POSIX prefix on the command string
 * (`GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-…}" git …`).
 * `system.run` shells out through `cmd.exe` on Windows, which does not read
 * `VAR=value cmd` as an assignment but as a command name — so every `lt git
 * update` failed there with "'GIT_TERMINAL_PROMPT' is not recognized". Handing
 * the variables to the child as its environment works on every platform.
 *
 * The `||` keeps the semantics of the shell's `:-` default: a caller who
 * configured ssh deliberately (a user with a custom agent, or a test harness
 * pinning the behaviour) still wins. See `git.ts#gitInstalled` for why the
 * assignment must never be unconditional.
 */
/**
 * Update branch
 */
const NewCommand: GluegunCommand = {
  alias: ['up'],
  description: 'Update branch',
  hidden: false,
  name: 'update',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      git,
      helper,
      npm,
      parameters,
      print: { info, spin, success, warning },
      system: { run, startTimer },
    } = toolbox;

    // Parse dry-run flag early
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Load configuration
    const ltConfig = config.loadConfig();
    const configSkipInstall = ltConfig?.commands?.git?.update?.skipInstall;
    const globalSkipInstall = config.getGlobalDefault<boolean>(ltConfig, 'skipInstall');

    // Determine skipInstall with priority: CLI > config > global > default (false)
    const skipInstall = config.getValue({
      cliValue: parameters.options.skipInstall || parameters.options['skip-install'],
      configValue: configSkipInstall,
      defaultValue: false,
      globalValue: globalSkipInstall,
    });

    // Get current branch
    const branch = await git.currentBranch();

    // Dry-run mode: show what would happen
    if (dryRun) {
      warning('DRY-RUN MODE - No changes will be made');
      info('');
      info(`Current branch: ${branch}`);
      info('');

      // Fetch to see incoming changes (use short SSH timeout so it doesn't hang offline).
      // Best effort: offline or without credentials the preview falls back to the local refs.
      try {
        await run('git fetch', { env: nonInteractiveGitEnv() });
      } catch {
        // ignore - a failed fetch only makes the preview less current
      }

      // Check for incoming commits (none yet when the upstream ref is unknown locally)
      let incomingCommits = '';
      try {
        incomingCommits = await run(`git log ${branch}..origin/${branch} --oneline`);
      } catch {
        // ignore - no upstream ref, so nothing incoming to report
      }
      const commits =
        incomingCommits
          ?.trim()
          .split('\n')
          .filter((c) => c) || [];

      if (commits.length > 0) {
        info(`Incoming commits (${commits.length}):`);
        commits.slice(0, 10).forEach((c) => info(`  ${c}`));
        if (commits.length > 10) {
          info(`  ... and ${commits.length - 10} more`);
        }
      } else {
        info('No incoming commits - branch is up to date.');
      }

      info('');
      info('Steps that would be executed:');
      info('  1. git fetch');
      info('  2. git pull');
      if (!skipInstall) {
        info(`  3. ${toolbox.pm.install()}`);
      } else {
        info(`  3. ${toolbox.pm.install()} (SKIPPED via config)`);
      }

      return `dry-run update branch ${branch}`;
    }

    // Start timer
    const timer = startTimer();

    // Update
    const updateSpin = spin(`Update branch ${branch}`);
    try {
      await run('git fetch', { env: nonInteractiveGitEnv() });
    } catch {
      // ignore - `git pull --rebase` below fetches again and reports the real failure
    }
    await run('git pull --rebase', { env: nonInteractiveGitEnv() });
    updateSpin.succeed();

    // Install packages (unless skipped) with correctly detected package manager (supports monorepo lockfiles)
    if (!skipInstall) {
      const { path: pkgPath } = await npm.getPackageJson();
      if (pkgPath) {
        const projectDir = dirname(pkgPath);
        const detectedPm = toolbox.pm.detect(projectDir);
        const installSpin = spin(`Install packages using ${detectedPm}`);
        // `cwd` instead of `cd <dir> &&`: cmd.exe's `cd` does not switch drives,
        // and it needs no quoting for paths with spaces.
        await run(toolbox.pm.install(detectedPm), { cwd: projectDir });
        installSpin.succeed();
      }
    }

    // Success
    success(`Updated ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `updated ${branch}`;
  },
};

export default NewCommand;
