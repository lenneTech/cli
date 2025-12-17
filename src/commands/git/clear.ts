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
    const configNoConfirm = ltConfig?.commands?.git?.clear?.noConfirm ?? ltConfig?.commands?.git?.noConfirm;

    // Load global defaults
    const globalNoConfirm = config.getGlobalDefault<boolean>(ltConfig, 'noConfirm');

    // Parse CLI arguments
    const cliNoConfirm = parameters.options.noConfirm;

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getValue({
      cliValue: cliNoConfirm,
      configValue: configNoConfirm,
      defaultValue: false,
      globalValue: globalNoConfirm,
    });

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get current branch
    const branch = await git.currentBranch();

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

    // For tests
    return `clear branch ${branch}`;
  },
};

export default NewCommand;
