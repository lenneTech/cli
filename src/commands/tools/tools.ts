import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Tool commands
 */
module.exports = {
  alias: ['t'],
  description: 'Tools commands',
  hidden: true,
  name: 'tools',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('tools');
    return 'tools';
  },
};
