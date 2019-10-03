import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * CLI commands
 */
module.exports = {
  name: 'cli',
  alias: ['c'],
  description: 'Commands to create a CLI',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('cli', { headline: 'CLI commands' });
    return 'cli';
  }
};
