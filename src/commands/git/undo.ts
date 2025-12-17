import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Undo last commit (without loosing files)
 */
const NewCommand: GluegunCommand = {
  alias: ['un'],
  description: 'Undo last commit',
  hidden: false,
  name: 'undo',
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
    const configNoConfirm = ltConfig?.commands?.git?.undo?.noConfirm ?? ltConfig?.commands?.git?.noConfirm;

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

    // Last commit message
    const lastCommitMessage = await git.lastCommitMessage();

    // Ask to undo the commit
    if (!noConfirm && !(await confirm(`Undo last commit "${lastCommitMessage}"?`))) {
      return;
    }

    // Start timer
    const timer = startTimer();

    // Get current branch
    const branch = await git.currentBranch();

    // Reset soft
    const undoSpinner = spin(`Undo last commit of branch ${branch}`);
    await run('git reset --soft HEAD~');
    undoSpinner.succeed();

    // Success
    success(`Undo last commit of ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `undo last commit of branch ${branch}`;
  },
};

export default NewCommand;
