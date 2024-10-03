import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Server commands
 */
module.exports = {
  alias: ['s'],
  description: 'Server commands',
  hidden: true,
  name: 'server',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('server');
    return 'server';
  },
};
