import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Directus commands
 */
module.exports = {
  alias: ['d'],
  description: 'Directus instance management commands',
  hidden: true,
  name: 'directus',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('directus');
    return 'directus';
  },
};