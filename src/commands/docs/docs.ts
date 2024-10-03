import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Docs commands
 */
module.exports = {
  alias: ['d'],
  description: 'Docs commands',
  hidden: true,
  name: 'docs',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('docs');
    return 'docs';
  },
};
