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
      config,
      git,
      helper,
      parameters,
      print: { info, spin, success, warning },
      prompt: { confirm },
      system: { run, startTimer },
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();

    // Parse CLI arguments
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.git?.clean,
      config: ltConfig,
      parentConfig: ltConfig?.commands?.git,
    });

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    const excludedBranches = ['main', 'test', 'dev', 'develop'];

    // Dry-run mode: show what would be deleted (without side effects)
    if (dryRun) {
      warning('DRY-RUN MODE - No changes will be made');
      info('');

      // Get current merged branches without fetching
      const result = await system.run('git branch --merged');
      const branches = result
        .split('\n')
        .map((b) => b.trim().replace(/^\* /, ''))
        .filter((b) => b && !excludedBranches.includes(b));

      if (branches.length === 0) {
        info('No merged branches to delete.');
        info('');
        info('Note: Run without --dry-run to fetch latest from remote first.');
        return 'dry-run clean: no branches';
      }

      info(`Would delete ${branches.length} merged branch(es):`);
      branches.forEach((b) => info(`  - ${b}`));
      info('');
      info(`Excluded branches: ${excludedBranches.join(', ')}`);
      info('');
      info('Actions that would be performed:');
      info('  1. Checkout dev/main branch');
      info('  2. Fetch and prune remote');
      info('  3. Pull latest changes');
      info('  4. Delete merged branches');

      return `dry-run clean: ${branches.length} branches`;
    }

    // Get current branch
    const currentBranch = await git.currentBranch();

    // Ask for confirmation before cleaning
    if (!noConfirm && !(await confirm('Remove all merged branches?'))) {
      return;
    }

    let branch;
    if (currentBranch !== 'dev' && currentBranch !== 'main') {
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

    // Local Branches into Array
    const branches = result
      .split('\n')
      .map((b) => b.trim().replace(/^\* /, '')) // Remove '* '
      .filter((b) => b && !excludedBranches.includes(b));

    if (branches.length === 0) {
      undoSpinner.succeed();
      info('No branches to delete.');
      return;
    }

    info(`Deleting branches: ${branches.join(', ')}`);

    // Delete branches
    for (const branchToDelete of branches) {
      await system.run(`git branch -d ${branchToDelete}`);
      success(`Deleted branch: ${branchToDelete}`);
    }

    undoSpinner.succeed();

    // Success
    success(`Successfully cleaned in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return 'cleaned branches';
  },
};

export default NewCommand;
