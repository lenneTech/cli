import { GluegunCommand, system } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Removed local merged branches
 */
const NewCommand: GluegunCommand = {
  alias: ['rm'],
  description: 'Remove merged branches',
  hidden: false,
  name: 'clean',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      print: { info, spin, success },
      system: { run, startTimer },
    } = toolbox;

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get current branch
    const currentBranch = await git.currentBranch();

    let branch;
    if (currentBranch !== 'dev' || currentBranch !== 'main') {
      // Search for branch, which includes branch name
      branch = await git.getBranch('dev', {
        error: false,
        exact: false,
        remote: false,
        spin: true,
      });

      if (branch !== 'dev') {
        branch = await git.getBranch('main', {
          error: true,
          exact: false,
          remote: false,
          spin: true,
        });
      }

      await run(`git checkout ${branch}`);
      info(`Changed Branch to ${branch}`);
    }

    // Start timer
    const timer = startTimer();

    // Reset soft
    const undoSpinner = spin('Start cleaning\n');

    const resultFetch = await run('git fetch -p');
    info(resultFetch);

    const resultpull = await run('git pull');
    info(resultpull);

    const result = await system.run('git branch --merged');
    const excludedBranches = ['main', 'dev', 'develop', 'beta', 'intern', 'release'];

    // Local Branches into Array
    const branches = result
      .split('\n')
      .map(branch => branch.trim().replace(/^\* /, '')) // Remove '* '
      .filter(branch => branch && !excludedBranches.includes(branch));

    if (branches.length === 0) {
      info('No branches to delete.');
      return;
    }

    info(`Deleting branches: ${branches.join(', ')}`);

    // Delete branches
    for (const branch of branches) {
      await system.run(`git branch -d ${branch}`);
      success(`Deleted branch: ${branch}`);
    }

    undoSpinner.succeed();

    // Success
    success(`Successfull cleaned in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // For tests
    return 'cleaned local';
  },
};

export default NewCommand;
