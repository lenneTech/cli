import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Claude commands
 */
module.exports = {
  alias: ['c'],
  description: 'Claude commands',
  hidden: true,
  name: 'claude',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('claude');
    return 'claude';
  },
};