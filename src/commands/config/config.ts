import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Config commands
 */
module.exports = {
  alias: ['cfg'],
  description: 'Configuration file management',
  hidden: false,
  name: 'config',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('config');
    return 'config';
  },
};
