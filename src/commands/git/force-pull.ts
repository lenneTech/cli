import { GluegunCommand } from 'gluegun';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Pull branch with loosing changes
 */
const NewCommand: GluegunCommand = {
  name: 'force-pull',
  alias: ['pf', 'pull-force'],
  description: 'Pull branch with loosing changes',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      parameters,
      prompt,
      print: { info, spin, success },
      system: { run, startTimer },
    } = toolbox;

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get current branch
    const branch = await git.currentBranch();

    // Ask for reset
    if (!parameters.options.noConfirm && !(await prompt.confirm(`You will lose your changes, are you sure?`))) {
      return;
    }

    // Start timer
    const timer = startTimer();

    // Reset soft
    const pullSpinner = spin(`Fetch and pull ${branch}`);
    await run(`git fetch && git reset origin/${branch} --hard`);
    pullSpinner.succeed();

    // Success
    success(`Pull ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // For tests
    return `pull branch ${branch}`;
  },
};

export default NewCommand;
