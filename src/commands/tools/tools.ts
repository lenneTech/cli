import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Tool commands
 */
module.exports = {
  name: 'tools',
  alias: ['t'],
  description: 'Tools commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('tools');
    return 'tools';
  }
};
