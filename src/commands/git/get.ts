import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Checkout git branch
 */
const NewCommand: GluegunCommand = {
  alias: ['g'],
  description: 'Checkout git branch',
  hidden: false,
  name: 'get',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
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

    // Get (part of) branch name
    const branchName = await helper.getInput(parameters.first, {
      name: 'branch name',
      showError: true,
    });
    if (!branchName) {
      return;
    }

    // Check changes in current branch (reset necessary)
    if (!(await git.askForReset({ showError: true }))) {
      return;
    }

    // Search for branch, which includes branch name
    const branch = await git.getBranch(branchName, {
      error: true,
      exact: false,
      remote: false,
      spin: true,
    });
    info(`Found branch ${branch} for ${branchName}`);
    if (!branch) {
      return;
    }

    // Get remote branch
    const remoteBranch = await git.getBranch(branch, { remote: true });

    // Ask for checkout branch
    if (branchName !== branch) {
      if (
        !parameters.options.noConfirm
        && !(await prompt.confirm(`Checkout ${remoteBranch ? 'remote' : 'local'} branch ${branch}`))
      ) {
        return;
      }
    }

    // Checkout branch
    await system.run(`git checkout ${(await git.getDefaultBranch()) || 'main'}`);
    let checkoutSpin;

    // Handling for remote
    if (remoteBranch) {
      // Delete local
      let removed = false;
      const checkSpin = spin('Check status');
      if (branch !== 'main' && branch && (await git.diffFiles(branch, { noDiffResult: '' })).length) {
        checkSpin.succeed();
        let mode = parameters.options.mode;
        if (!mode) {
          if (await prompt.confirm(`Remove local commits of ${branch}`)) {
            mode = 'hard';
          }
        }
        if (mode === 'hard') {
          const prepareSpin = spin(`Refresh ${branch}`);
          await system.run(`git branch -D ${branch}`);
          removed = true;
          prepareSpin.succeed();
        }
      } else {
        checkSpin.succeed();
      }

      // Start spin
      checkoutSpin = spin(`Checkout ${branch}`);

      // Checkout remote if local branch not exists
      if (removed || !(await git.getBranch(branch, { local: true }))) {
        await system.run(
          `git fetch && git checkout --track origin/${branch} && git reset --hard && git clean -fd && git pull`,
        );

        // Checkout local branch
      } else {
        await system.run(`git fetch && git checkout ${branch} && git reset --hard && git clean -fd && git pull`);
      }

      // Handling for local only
    } else if (branch) {
      checkoutSpin = spin(`Checkout ${branch}`);
      await system.run(`git fetch && git checkout ${branch} && git reset --hard && git clean -fd`);

      // No branch found
    } else {
      error(`Branch ${branch} not found!`);
      return;
    }

    // Checkout done
    checkoutSpin.succeed();

    // Install npm packages
    await npm.install();

    // Init lerna projects
    if (filesystem.isFile('./lerna.json')) {
      const initProjectsSpin = spin('Init projects');
      await system.run('npm run init --if-present');
      initProjectsSpin.succeed();
    }

    // Success info
    success(
      `${remoteBranch ? 'Remote' : 'Local'} branch ${branch} checked out in ${helper.msToMinutesAndSeconds(timer())}m.`,
    );
    info('');
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `get branch ${branch}`;
  },
};

export default NewCommand;
