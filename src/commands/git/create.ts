import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new branch
 */
const NewCommand: GluegunCommand = {
  alias: ['c'],
  description: 'Create new branch',
  hidden: false,
  name: 'create',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      git,
      helper,
      npm,
      parameters,
      print: { error, info, spin, success },
      system,
    } = toolbox;

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Load configuration
    const ltConfig = config.loadConfig();
    const configBaseBranch = ltConfig?.commands?.git?.baseBranch;

    // Load global defaults
    const globalBaseBranch = config.getGlobalDefault<string>(ltConfig, 'baseBranch');

    // Parse CLI arguments
    const { base: cliBaseBranch } = parameters.options;

    // Check changes in current branch (reset optional)
    await git.askForReset();

    // Get branch name
    const branch = await helper.getInput(parameters.first, {
      name: 'branch name',
      showError: true,
    });
    if (!branch) {
      return;
    }

    // Check if branch already exists
    if (await git.getBranch(branch)) {
      error(`Branch ${branch} already exists!`);
      return;
    }

    // Determine base branch with priority: CLI > config > global > interactive
    let baseBranch: string | undefined;

    // Helper function to validate and use a branch
    const tryUseBranch = async (branch: string, source: string): Promise<boolean> => {
      if (await git.getBranch(branch)) {
        baseBranch = branch;
        info(`Using base branch from ${source}: ${branch}`);
        return true;
      }
      info(`Configured base branch "${branch}" not found (${source}), trying next source...`);
      return false;
    };

    if (cliBaseBranch) {
      // CLI parameter provided
      if (await git.getBranch(cliBaseBranch)) {
        baseBranch = cliBaseBranch;
      } else {
        error(`Base branch ${cliBaseBranch} does not exist!`);
        return;
      }
    } else if (configBaseBranch) {
      // Command-specific config value provided
      if (!(await tryUseBranch(configBaseBranch, 'lt.config commands.git'))) {
        // Fall through to global or interactive
        if (globalBaseBranch && globalBaseBranch !== configBaseBranch) {
          await tryUseBranch(globalBaseBranch, 'lt.config defaults');
        }
      }
    } else if (globalBaseBranch) {
      // Global default value provided
      await tryUseBranch(globalBaseBranch, 'lt.config defaults');
    }

    // If no baseBranch yet, check parameters or go interactive
    if (!baseBranch) {
      const paramBaseBranch = parameters.second;
      if (paramBaseBranch && (await git.getBranch(paramBaseBranch))) {
        baseBranch = paramBaseBranch;
      } else {
        // Interactive mode
        baseBranch = await git.selectBranch({ text: 'Select base branch' });
      }
    }

    if (!baseBranch) {
      error('No base branch selected!');
      return;
    }

    // Start timer
    const timer = system.startTimer();

    // Checkout
    const createSpin = spin(`Create ${branch}`);
    await system.run('git fetch &&' + `git checkout ${baseBranch} &&` + 'git pull && ' + `git checkout -b ${branch}`);
    createSpin.succeed();

    // Install npm packages
    await npm.install();

    // Success info
    success(`Branch ${branch} was created from ${baseBranch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // For tests
    return `created branch ${branch}`;
  },
};

export default NewCommand;
