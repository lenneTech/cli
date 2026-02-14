import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Pull branch with losing changes
 */
const NewCommand: GluegunCommand = {
  alias: ['pf', 'pull-force'],
  description: 'Force pull (discard local)',
  hidden: false,
  name: 'force-pull',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      git,
      helper,
      parameters,
      print: { info, spin, success, warning },
      prompt,
      system: { run, startTimer },
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();

    // Parse CLI arguments
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.git?.forcePull,
      config: ltConfig,
      parentConfig: ltConfig?.commands?.git,
    });

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get current branch
    const branch = await git.currentBranch();

    // Dry-run mode: show what would be affected
    if (dryRun) {
      warning('DRY-RUN MODE - No changes will be made');
      info('');

      // Show local changes that would be lost
      const status = await run('git status --porcelain');
      if (status?.trim()) {
        const lines = status.trim().split('\n');
        info(`Would discard on branch "${branch}":`);
        info(`  - ${lines.length} file(s) with local changes`);
        info('');
        info('Files:');
        lines.forEach((line) => info(`  ${line}`));
      } else {
        info('No local changes to discard.');
      }

      // Show commits that would be lost
      const localCommits = await run(`git log origin/${branch}..HEAD --oneline 2>/dev/null || echo ""`);
      if (localCommits?.trim()) {
        info('');
        info('Local commits that would be lost:');
        localCommits
          .trim()
          .split('\n')
          .forEach((line) => info(`  ${line}`));
      }

      return `dry-run force-pull branch ${branch}`;
    }

    // Ask for reset
    if (!noConfirm && !(await prompt.confirm('You will lose your changes, are you sure?'))) {
      return;
    }

    // Start timer
    const timer = startTimer();

    // Reset soft
    const pullSpinner = spin(`Fetch and pull ${branch}`);
    await run(`git fetch && git reset origin/${branch} --hard`);
    pullSpinner.succeed();

    // Success
    success(`Force pulled ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `force pulled ${branch}`;
  },
};

export default NewCommand;
