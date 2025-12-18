import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Undo last commit (without losing files)
 */
const NewCommand: GluegunCommand = {
  alias: ['un'],
  description: 'Undo last commit',
  hidden: false,
  name: 'undo',
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
      commandConfig: ltConfig?.commands?.git?.undo,
      config: ltConfig,
      parentConfig: ltConfig?.commands?.git,
    });

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Last commit message
    const lastCommitMessage = await git.lastCommitMessage();

    // Dry-run mode: show what would be affected
    if (dryRun) {
      warning('DRY-RUN MODE - No changes will be made');
      info('');

      // Get current branch
      const branch = await git.currentBranch();

      // Show commit details
      const commitDetails = await run('git log -1 --format="%h %s%n  Author: %an <%ae>%n  Date: %ad" --date=short');
      info(`Would undo last commit on branch "${branch}":`);
      info('');
      info('Commit to undo:');
      commitDetails?.trim().split('\n').forEach(line => info(`  ${line}`));

      // Show files that would become staged
      const changedFiles = await run('git diff-tree --no-commit-id --name-status -r HEAD');
      if (changedFiles?.trim()) {
        info('');
        info('Files that would become staged:');
        changedFiles.trim().split('\n').forEach(line => info(`  ${line}`));
      }

      info('');
      info('Note: This uses --soft reset, so changes are preserved as staged.');

      return `dry-run undo last commit on branch ${branch}`;
    }

    // Ask to undo the commit
    if (!noConfirm && !(await confirm(`Undo last commit "${lastCommitMessage}"?`))) {
      return;
    }

    // Start timer
    const timer = startTimer();

    // Get current branch
    const branch = await git.currentBranch();

    // Reset soft
    const undoSpinner = spin(`Undo last commit of branch ${branch}`);
    await run('git reset --soft HEAD~');
    undoSpinner.succeed();

    // Success
    success(`Undo last commit of ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `undo last commit of branch ${branch}`;
  },
};

export default NewCommand;
