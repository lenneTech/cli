import { GluegunCommand } from 'gluegun';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Removed local merged branches
 */
const NewCommand: GluegunCommand = {
  name: 'clean',
  alias: ['rm'],
  description: 'Removed local merged branches',
  hidden: false,
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
    if (currentBranch !== 'develop' || currentBranch !== 'main') {
      // Search for branch, which includes branch name
      branch = await git.getBranch('develop', {
        error: false,
        exact: false,
        remote: false,
        spin: true,
      });

      if (branch !== 'develop') {
        branch = await git.getBranch('main', {
          error: true,
          exact: false,
          remote: false,
          spin: true,
        });
      }

      await run(`git checkout ${branch}`);
      info('Changed Branch to ' + branch);
    }

    // Start timer
    const timer = startTimer();

    // Reset soft
    const undoSpinner = spin(`Start cleaning`);

    const resultFetch = await run('git fetch -p');
    info(resultFetch);

    const resultpull = await run('git pull');
    info(resultpull);

    const resultDelete = await run(
      `git branch --merged | egrep -v "(^\\*|main|dev|develop|beta|intern|release)" | xargs git branch -d`
    );
    info(resultDelete);

    undoSpinner.succeed();

    // Success
    success(`Successfull cleaned in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // For tests
    return `cleaned local`;
  },
};

export default NewCommand;
