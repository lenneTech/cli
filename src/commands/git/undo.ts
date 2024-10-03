import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Undo last commit (without loosing files)
 */
const NewCommand: GluegunCommand = {
  alias: ['un'],
  description: 'Undo last commit (without loosing files)',
  hidden: false,
  name: 'undo',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      parameters,
      print: { info, spin, success },
      prompt: { confirm },
      system: { run, startTimer },
    } = toolbox;

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Last commit message
    const lastCommitMessage = await git.lastCommitMessage();

    // Ask to squash the branch
    if (!parameters.options.noConfirm && !(await confirm(`Undo last commit "${lastCommitMessage}"?`))) {
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
