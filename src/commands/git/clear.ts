import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Undo current changes
 */
const NewCommand: GluegunCommand = {
  alias: ['cl'],
  description: 'Discard local changes',
  hidden: false,
  name: 'clear',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      git,
      helper,
      parameters,
      print: { info, spin, success },
      prompt: { confirm },
      system: { run, startTimer },
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();

    // Parse CLI arguments
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.git?.clear,
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
      const result = await git.showDryRunInfo({ branch, operation: 'discard' });
      return result || `dry-run clear branch ${branch}`;
    }

    // Ask to clear the branch
    if (!noConfirm && !(await confirm(`Clear "${branch}"?`))) {
      return;
    }

    // Start timer
    const timer = startTimer();

    // Reset soft
    const undoSpinner = spin(`Clear ${branch}`);
    await run('git reset --hard && git clean -fd');
    undoSpinner.succeed();

    // Success
    success(`Clear ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `clear branch ${branch}`;
  },
};

export default NewCommand;
