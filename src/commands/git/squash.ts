import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Squash branch
 */
const NewCommand: GluegunCommand = {
  alias: ['s'],
  description: 'Squash branch',
  hidden: false,
  name: 'squash',
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
    if (['dev', 'develop', 'main', 'master', 'release', 'test'].includes(branch)) {
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
    
    // Start timer
    const timer = startTimer();

    // Get description
    const base = await helper.getInput(parameters.first, {
      initial: 'dev',
      name: 'Base branche',
      showError: false,
    });

    // Merge base
    const mergeBaseSpin = spin(`Get merge ${base}`);
    const mergeBase = await git.getMergeBase(base);
    if (!mergeBase) {
      error('No merge base found!');
      return;
    }
    mergeBaseSpin.succeed();

    // Get squash message (before reset)
    const squashMessage = await git.getFirstBranchCommit(await git.currentBranch(), base);

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
          initial: `${user.name} <${user.email}>`,
          message: 'Author: ',
          name: 'author',
          type: 'input',
        })
      ).author;
    }

    // Ask for message
    let message = parameters.options.message;
    if (!message) {
      message = (
        await ask({
          initial: squashMessage,
          message: 'Message: ',
          name: 'message',
          type: 'input',
        })
      ).message;
    }

    // Confirm inputs
    info(author);
    info(message);
    if (!parameters.options.noConfirm && !(await confirm('Commit?'))) {
      return;
    }

    // Start spinner
    const commitSpin = spin('Commit');

    // Commit and push
    await run(`git commit -am "${message}" --author="${author}"`);
    commitSpin.succeed();
    
    if (!parameters.options.noConfirm && !(await confirm('Push force?'))) {
      return;
    }
    
    // Start timer
    const pushForceSpin = spin('Push force');
    
    // Push
    await run('git push -f origin HEAD');
    pushForceSpin.succeed();

    // Success
    success(`Squashed ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `squashed ${branch}`;
  },
};

export default NewCommand;
