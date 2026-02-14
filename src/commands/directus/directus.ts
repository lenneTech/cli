import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Directus commands
 */
const command = {
  alias: ['di'],
  description: 'Directus commands',
  hidden: false,
  name: 'directus',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('directus', {
      headline: 'Directus Commands',
    });
  },
};

export default command;
