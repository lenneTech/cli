import { GluegunCommand } from 'gluegun';
import { dirname } from 'path';

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
      print: { error, info, spin, success, warning },
      system,
    } = toolbox;

    // Parse dry-run flag early
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Load configuration
    const ltConfig = config.loadConfig();
    const commandBaseBranch = ltConfig?.commands?.git?.create?.base;
    const categoryBaseBranch = ltConfig?.commands?.git?.baseBranch;

    // Load global defaults
    const globalBaseBranch = config.getGlobalDefault<string>(ltConfig, 'baseBranch');

    // Parse CLI arguments
    const { base: cliBaseBranch } = parameters.options;

    // Check changes in current branch (reset optional) - skip in dry-run mode
    if (!dryRun) {
      await git.askForReset();
    }

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
    } else if (commandBaseBranch) {
      // Command-specific config value provided (git.create.base)
      if (!(await tryUseBranch(commandBaseBranch, 'lt.config commands.git.create'))) {
        // Fall through to category-level or global
        if (categoryBaseBranch && categoryBaseBranch !== commandBaseBranch) {
          if (!(await tryUseBranch(categoryBaseBranch, 'lt.config commands.git'))) {
            if (globalBaseBranch && globalBaseBranch !== categoryBaseBranch) {
              await tryUseBranch(globalBaseBranch, 'lt.config defaults');
            }
          }
        } else if (globalBaseBranch && globalBaseBranch !== commandBaseBranch) {
          await tryUseBranch(globalBaseBranch, 'lt.config defaults');
        }
      }
    } else if (categoryBaseBranch) {
      // Category-level config value provided (git.baseBranch)
      if (!(await tryUseBranch(categoryBaseBranch, 'lt.config commands.git'))) {
        // Fall through to global or interactive
        if (globalBaseBranch && globalBaseBranch !== categoryBaseBranch) {
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

    // Dry-run mode: show what would happen
    if (dryRun) {
      warning('DRY-RUN MODE - No changes will be made');
      info('');
      info('Would create branch:');
      info(`  - New branch: ${branch}`);
      info(`  - Base branch: ${baseBranch}`);
      info('');
      info('Steps that would be executed:');
      info('  1. git fetch');
      info(`  2. git checkout ${baseBranch}`);
      info('  3. git pull');
      info(`  4. git checkout -b ${branch}`);
      info(`  5. ${toolbox.pm.install()}`);
      return `dry-run create branch ${branch} from ${baseBranch}`;
    }

    // Start timer
    const timer = system.startTimer();

    // Checkout
    const createSpin = spin(`Create ${branch}`);
    await system.run('git fetch &&' + `git checkout ${baseBranch} &&` + 'git pull && ' + `git checkout -b ${branch}`);
    createSpin.succeed();

    // Install packages with correctly detected package manager (supports monorepo lockfiles)
    const { path: pkgPath } = await npm.getPackageJson();
    if (pkgPath) {
      const projectDir = dirname(pkgPath);
      const detectedPm = toolbox.pm.detect(projectDir);
      const installSpin = spin(`Install packages using ${detectedPm}`);
      await system.run(`cd ${projectDir} && ${toolbox.pm.install(detectedPm)}`);
      installSpin.succeed();
    }

    // Success info
    success(`Branch ${branch} was created from ${baseBranch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `created branch ${branch}`;
  },
};

export default NewCommand;
