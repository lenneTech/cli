import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Reset current branch
 */
const NewCommand: GluegunCommand = {
  alias: ['rs'],
  description: 'Reset current branch',
  hidden: false,
  name: 'reset',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      npm,
      parameters,
      print: { error, info, spin, success },
      prompt,
      system,
    } = toolbox;

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

    // Ask for reset
    if (!parameters.options.noConfirm && !(await prompt.confirm(`Reset branch ${branch} to the remote state`))) {
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
        + `git branch -D ${ 
        branch 
        } && `
        + `git checkout ${ 
        branch 
        } && `
        + 'git pull',
    );
    resetSpin.succeed();

    // Install npm packages
    await npm.install();

    // Success info
    success(`Branch ${branch} was reset in in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // For tests
    return `reset branch ${branch}`;
  },
};

export default NewCommand;
