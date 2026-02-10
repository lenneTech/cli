import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Reset current branch
 */
const NewCommand: GluegunCommand = {
  alias: ['rs'],
  description: 'Reset to remote state',
  hidden: false,
  name: 'reset',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      git,
      helper,
      npm,
      parameters,
      print: { error, info, spin, success, warning },
      prompt,
      system,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();

    // Parse CLI arguments
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.git?.reset,
      config: ltConfig,
      parentConfig: ltConfig?.commands?.git,
    });

    // Start timer
    const timer = system.startTimer();

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Current branch
    const branch = await git.currentBranch();
    if (!branch) {
      error('No current branch!');
      return;
    }

    // Check remote
    const remoteBranch = await system.run(`git ls-remote --heads origin ${branch}`);
    if (!remoteBranch) {
      error(`No remote branch ${branch} found!`);
      return;
    }

    // Dry-run mode: show what would be affected
    if (dryRun) {
      warning('DRY-RUN MODE - No changes will be made');
      info('');

      // Show local changes that would be lost
      const status = await system.run('git status --porcelain');
      if (status?.trim()) {
        const lines = status.trim().split('\n');
        info(`Would discard on branch "${branch}":`);
        info(`  - ${lines.length} file(s) with local changes`);
        info('');
        info('Files:');
        lines.forEach(line => info(`  ${line}`));
      } else {
        info('No local changes to discard.');
      }

      // Show commits that would be lost
      const localCommits = await system.run(`git log origin/${branch}..HEAD --oneline 2>/dev/null || echo ""`);
      if (localCommits?.trim()) {
        info('');
        info('Local commits that would be lost:');
        localCommits.trim().split('\n').forEach(line => info(`  ${line}`));
      }

      info('');
      info('Actions that would be performed:');
      info('  1. Clean untracked files (git clean -fd)');
      info('  2. Reset HEAD (git reset HEAD --hard)');
      info('  3. Checkout main and pull');
      info(`  4. Delete local branch "${branch}"`);
      info(`  5. Checkout "${branch}" from remote`);
      info(`  6. Run ${toolbox.pm.install()}`);

      return `dry-run reset branch ${branch}`;
    }

    // Ask for reset
    if (!noConfirm && !(await prompt.confirm(`Reset branch ${branch} to the remote state`))) {
      return;
    }

    // Reset
    const resetSpin = spin(`Reset ${branch}`);
    await system.run(
      'git clean -fd && '
        + 'git reset HEAD --hard && '
        + 'git checkout main && '
        + 'git fetch && '
        + 'git pull && '
        + `git branch -D ${branch} && `
        + `git checkout ${branch} && `
        + 'git pull',
    );
    resetSpin.succeed();

    // Install npm packages
    await npm.install();

    // Success info
    success(`Branch ${branch} was reset in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `reset branch ${branch}`;
  },
};

export default NewCommand;
