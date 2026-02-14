import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Blocks commands
 */
module.exports = {
  alias: ['bl'],
  description: 'Base blocks for Nuxt',
  hidden: true,
  name: 'blocks',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('blocks');
    return 'blocks';
  },
};
