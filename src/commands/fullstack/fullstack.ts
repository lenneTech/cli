import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Fullstack commands
 */
module.exports = {
  name: 'fullstack',
  alias: ['full'],
  description: 'Fullstack commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('fullstack');
    return 'fullstack';
  },
};
