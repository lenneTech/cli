import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Update branch
 */
const NewCommand: GluegunCommand = {
  alias: ['up'],
  description: 'Update branch',
  hidden: false,
  name: 'update',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      git,
      helper,
      npm,
      parameters,
      print: { info, spin, success, warning },
      system: { run, startTimer },
    } = toolbox;

    // Parse dry-run flag early
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Load configuration
    const ltConfig = config.loadConfig();
    const configSkipInstall = ltConfig?.commands?.git?.update?.skipInstall;
    const globalSkipInstall = config.getGlobalDefault<boolean>(ltConfig, 'skipInstall');

    // Determine skipInstall with priority: CLI > config > global > default (false)
    const skipInstall = config.getValue({
      cliValue: parameters.options.skipInstall || parameters.options['skip-install'],
      configValue: configSkipInstall,
      defaultValue: false,
      globalValue: globalSkipInstall,
    });

    // Get current branch
    const branch = await git.currentBranch();

    // Dry-run mode: show what would happen
    if (dryRun) {
      warning('DRY-RUN MODE - No changes will be made');
      info('');
      info(`Current branch: ${branch}`);
      info('');

      // Fetch to see incoming changes
      await run('git fetch');

      // Check for incoming commits
      const incomingCommits = await run(`git log ${branch}..origin/${branch} --oneline 2>/dev/null || echo ""`);
      const commits = incomingCommits?.trim().split('\n').filter(c => c) || [];

      if (commits.length > 0) {
        info(`Incoming commits (${commits.length}):`);
        commits.slice(0, 10).forEach(c => info(`  ${c}`));
        if (commits.length > 10) {
          info(`  ... and ${commits.length - 10} more`);
        }
      } else {
        info('No incoming commits - branch is up to date.');
      }

      info('');
      info('Steps that would be executed:');
      info('  1. git fetch');
      info('  2. git pull');
      if (!skipInstall) {
        info('  3. npm install');
      } else {
        info('  3. npm install (SKIPPED via config)');
      }

      return `dry-run update branch ${branch}`;
    }

    // Start timer
    const timer = startTimer();

    // Update
    const updateSpin = spin(`Update branch ${branch}`);
    await run('git fetch && git pull');
    updateSpin.succeed();

    // Install npm packages (unless skipped)
    if (!skipInstall) {
      await npm.install();
    }

    // Success
    success(`Updated ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `updated ${branch}`;
  },
};

export default NewCommand;
