import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Docs commands
 */
module.exports = {
  name: 'docs',
  alias: ['d'],
  description: 'Docs commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('docs');
    return 'docs';
  }
};
