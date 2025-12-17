import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Squash branch
 */
const NewCommand: GluegunCommand = {
  alias: ['s'],
  description: 'Squash commits',
  hidden: false,
  name: 'squash',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      git,
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt: { ask, confirm },
      system: { run, startTimer },
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configNoConfirm = ltConfig?.commands?.git?.squash?.noConfirm ?? ltConfig?.commands?.git?.noConfirm;
    const configBase = ltConfig?.commands?.git?.squash?.base;
    const configAuthor = ltConfig?.commands?.git?.squash?.author;

    // Load global defaults
    const globalNoConfirm = config.getGlobalDefault<boolean>(ltConfig, 'noConfirm');
    const globalBaseBranch = config.getGlobalDefault<string>(ltConfig, 'baseBranch');
    const globalAuthor = config.getGlobalDefault<string>(ltConfig, 'author');

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
    if (!noConfirm && !(await confirm(`Squash branch ${branch}?`))) {
      return;
    }

    // Start timer
    const timer = startTimer();

    // Determine base branch with priority: CLI > config > global > interactive
    const cliBase = parameters.first;
    let base: string;
    if (cliBase) {
      base = cliBase;
    } else if (configBase) {
      base = configBase;
      info(`Using base branch from lt.config commands.git.squash: ${configBase}`);
    } else if (globalBaseBranch) {
      base = globalBaseBranch;
      info(`Using base branch from lt.config defaults: ${globalBaseBranch}`);
    } else {
      base = await helper.getInput('', {
        initial: 'dev',
        name: 'Base branch',
        showError: false,
      });
    }

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
    if (!noConfirm && !(await confirm('Continue?'))) {
      return;
    }

    // Get git user
    const user = await git.getUser();

    // Determine author with priority: CLI > config > global > interactive
    const cliAuthor = parameters.options.author;
    let author: string;
    if (cliAuthor) {
      author = cliAuthor;
    } else if (configAuthor) {
      author = configAuthor;
      info(`Using author from lt.config commands.git.squash: ${configAuthor}`);
    } else if (globalAuthor) {
      author = globalAuthor;
      info(`Using author from lt.config defaults: ${globalAuthor}`);
    } else if (noConfirm) {
      // In noConfirm mode, use git user as default
      author = `${user.name} <${user.email}>`;
    } else {
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
    if (!message && !noConfirm) {
      message = (
        await ask({
          initial: squashMessage,
          message: 'Message: ',
          name: 'message',
          type: 'input',
        })
      ).message;
    } else if (!message) {
      // In noConfirm mode without message, use the first commit message
      message = squashMessage;
    }

    // Confirm inputs
    info(author);
    info(message);
    if (!noConfirm && !(await confirm('Commit?'))) {
      return;
    }

    // Start spinner
    const commitSpin = spin('Commit');

    // Commit and push
    await run(`git commit -am "${message}" --author="${author}"`);
    commitSpin.succeed();
    
    if (!noConfirm && !(await confirm('Push force?'))) {
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
