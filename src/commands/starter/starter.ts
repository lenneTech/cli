import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Starter commands
 */
module.exports = {
  name: 'starter',
  alias: ['st'],
  description: 'Starter commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('starter');
    return 'starter';
  }
};
