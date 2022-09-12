import { GluegunCommand } from 'gluegun';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Squash branch
 */
const NewCommand: GluegunCommand = {
  name: 'squash',
  alias: ['s'],
  description: 'Squash branch',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt: { ask, confirm },
      system: { run, startTimer },
    } = toolbox;

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get current branch
    const branch = await git.currentBranch();

    // Check branch
    if (['master', 'main', 'release', 'test', 'develop', 'dev'].includes(branch)) {
      error(`Squash of branch ${branch} is not allowed!`);
      return;
    }

    // Check for changes
    if (await git.changes({ showError: true })) {
      return;
    }

    // Ask to squash the branch
    if (!parameters.options.noConfirm && !(await confirm(`Squash branch ${branch}?`))) {
      return;
    }

    // Get description
    let base = parameters.first;
    if (!base) {
      base = await helper.getInput('develop', {
        name: 'Base branche',
        showError: false,
      });
    }

    // Merge base
    const mergeBaseSpin = spin('Get merge ' + base);
    const mergeBase = await git.getMergeBase(base);
    if (!mergeBase) {
      error('No merge base found!');
      return;
    }
    mergeBaseSpin.succeed();

    // Soft reset
    const resetSpin = spin('Soft reset');
    await git.reset(mergeBase, true);
    resetSpin.succeed();

    // Get status
    const status = await git.status();

    // Ask to go on
    info(`You are now on commit ${mergeBase}, with following changes:`);
    info(status);
    if (!parameters.options.noConfirm && !(await confirm('Continue?'))) {
      return;
    }

    // Get git user
    const user = await git.getUser();

    // Ask for author
    let author = parameters.options.author;
    if (!author) {
      author = (
        await ask({
          type: 'input',
          name: 'author',
          initial: `${user.name} <${user.email}>`,
          message: 'Author: ',
        })
      ).author;
    }

    // Ask for message
    let message = parameters.options.message;
    if (!message) {
      message = (
        await ask({
          type: 'input',
          name: 'message',
          initial: await git.getFirstBranchCommit(await git.currentBranch(), base),
          message: 'Message: ',
        })
      ).message;
    }

    // Confirm inputs
    info(author);
    info(message);
    if (!parameters.options.noConfirm && !(await confirm('Continue?'))) {
      return;
    }

    // Start timer
    const commitAndPushSpin = spin('Commit and push');
    const timer = startTimer();

    // Commit and push
    await run(`git commit -am "${message}" --author="${author}" && git push -f origin HEAD`);
    commitAndPushSpin.succeed();

    // Success
    success(`Squashed ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // For tests
    return `squashed ${branch}`;
  },
};

export default NewCommand;
