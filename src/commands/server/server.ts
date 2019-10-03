import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Server commands
 */
module.exports = {
  name: 'server',
  alias: ['s'],
  description: 'Server commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('server');
    return 'server';
  }
};
