import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Update npm packages
 */
const NewCommand: GluegunCommand = {
  alias: ['u', 'up'],
  description: 'Update npm packages',
  hidden: false,
  name: 'update',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      helper,
      npm,
      print: { success },
      system,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Update
    await npm.update({ install: true, showError: true });

    // Success info
    success(`Updated npm packages in ${helper.msToMinutesAndSeconds(timer())}m.`);

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return 'updated npm packages';
  },
};

export default NewCommand;
