import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Rebase branch
 */
const NewCommand: GluegunCommand = {
  alias: ['rb'],
  description: 'Rebase onto branch',
  hidden: false,
  name: 'rebase',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      git,
      helper,
      parameters,
      print: { error, info, spin, success, warning },
      prompt: { confirm },
      system: { run, startTimer },
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configBaseBranch = ltConfig?.commands?.git?.rebase?.base ?? ltConfig?.commands?.git?.baseBranch;

    // Load global defaults
    const globalBaseBranch = config.getGlobalDefault<string>(ltConfig, 'baseBranch');

    // Parse CLI arguments
    const cliBaseBranch = parameters.options.base;
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.git?.rebase,
      config: ltConfig,
      parentConfig: ltConfig?.commands?.git,
    });

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get current branch
    const branch = await git.currentBranch();

    // Check branch
    if (branch === 'main' || branch === 'release' || branch === 'dev') {
      error(`Rebase of branch ${branch} is not allowed!`);
      return;
    }

    // Determine base branch early for dry-run
    const baseBranchPreview = cliBaseBranch || parameters.first || configBaseBranch || globalBaseBranch || 'dev';

    // Dry-run mode: show what would be affected
    if (dryRun) {
      warning('DRY-RUN MODE - No changes will be made');
      info('');

      // Show commits that would be rebased
      const commitsToRebase = await run(`git log ${baseBranchPreview}..HEAD --oneline 2>/dev/null || echo ""`);
      if (commitsToRebase?.trim()) {
        const commitCount = commitsToRebase.trim().split('\n').length;
        info(`Would rebase ${commitCount} commit(s) from branch "${branch}" onto "${baseBranchPreview}":`);
        info('');
        info('Commits to be rebased:');
        commitsToRebase.trim().split('\n').forEach(line => info(`  ${line}`));
      } else {
        info(`No commits to rebase on branch "${branch}" (already up to date with "${baseBranchPreview}")`);
      }

      info('');
      info('Actions that would be performed:');
      info(`  1. Fetch latest changes`);
      info(`  2. Checkout and pull ${baseBranchPreview}`);
      info(`  3. Checkout ${branch}`);
      info(`  4. Rebase onto ${baseBranchPreview}`);

      return `dry-run rebase branch ${branch}`;
    }

    // Ask to Rebase the branch
    if (!noConfirm && !(await confirm(`Rebase branch ${branch}?`))) {
      return;
    }

    // Determine base branch with priority: CLI --base > CLI first param > config > global > interactive
    let baseBranch: string | undefined;

    // Helper function to validate and use a branch
    const tryUseBranch = async (branchName: string, source: string): Promise<boolean> => {
      if (await git.getBranch(branchName)) {
        baseBranch = branchName;
        info(`Using base branch from ${source}: ${branchName}`);
        return true;
      }
      info(`Configured base branch "${branchName}" not found (${source}), trying next source...`);
      return false;
    };

    if (cliBaseBranch) {
      // CLI --base parameter
      if (await git.getBranch(cliBaseBranch)) {
        baseBranch = cliBaseBranch;
      } else {
        error(`Base branch ${cliBaseBranch} does not exist!`);
        return;
      }
    } else if (parameters.first) {
      // CLI first parameter (positional)
      if (await git.getBranch(parameters.first)) {
        baseBranch = parameters.first;
      }
    }

    if (!baseBranch && configBaseBranch) {
      // Command-specific or git-level config
      if (!(await tryUseBranch(configBaseBranch, 'lt.config commands.git'))) {
        // Fall through to global
        if (globalBaseBranch && globalBaseBranch !== configBaseBranch) {
          await tryUseBranch(globalBaseBranch, 'lt.config defaults');
        }
      }
    } else if (!baseBranch && globalBaseBranch) {
      // Global default
      await tryUseBranch(globalBaseBranch, 'lt.config defaults');
    }

    // If still no baseBranch, go interactive
    if (!baseBranch) {
      baseBranch = await git.selectBranch({ text: 'Select base branch' });
    }

    // Start timer
    const timer = startTimer();

    // Rebase
    const rebaseSpin = spin(`Set ${baseBranch} as base of ${branch}`);
    await run(
      `git fetch && git checkout ${baseBranch} && git pull && git checkout ${branch} && git rebase ${baseBranch}`,
    );
    rebaseSpin.succeed();

    // Success
    success(`Rebased ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `rebased ${branch}`;
  },
};

export default NewCommand;
