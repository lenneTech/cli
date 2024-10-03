import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Starter commands
 */
module.exports = {
  alias: ['st'],
  description: 'Starter commands',
  hidden: true,
  name: 'starter',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('starter');
    return 'starter';
  },
};
