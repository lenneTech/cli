import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * CLI commands
 */
module.exports = {
  alias: ['cl'],
  description: 'Commands to create a CLI',
  hidden: true,
  name: 'cli',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('cli', { headline: 'CLI commands' });
    return 'cli';
  },
};
