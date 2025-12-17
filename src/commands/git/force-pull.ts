import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Pull branch with loosing changes
 */
const NewCommand: GluegunCommand = {
  alias: ['pf', 'pull-force'],
  description: 'Force pull (discard local)',
  hidden: false,
  name: 'force-pull',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      git,
      helper,
      parameters,
      print: { info, spin, success },
      prompt,
      system: { run, startTimer },
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configNoConfirm = ltConfig?.commands?.git?.forcePull?.noConfirm ?? ltConfig?.commands?.git?.noConfirm;

    // Load global defaults
    const globalNoConfirm = config.getGlobalDefault<boolean>(ltConfig, 'noConfirm');

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

    // Ask for reset
    if (!noConfirm && !(await prompt.confirm('You will lose your changes, are you sure?'))) {
      return;
    }

    // Start timer
    const timer = startTimer();

    // Reset soft
    const pullSpinner = spin(`Fetch and pull ${branch}`);
    await run(`git fetch && git reset origin/${branch} --hard`);
    pullSpinner.succeed();

    // Success
    success(`Pull ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // For tests
    return `pull branch ${branch}`;
  },
};

export default NewCommand;
