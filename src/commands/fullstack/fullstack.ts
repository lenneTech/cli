import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Fullstack commands
 */
module.exports = {
  alias: ['full'],
  description: 'Fullstack commands',
  hidden: true,
  name: 'fullstack',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('fullstack');
    return 'fullstack';
  },
};
