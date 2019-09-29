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
    const {
      helper: { commandSelector }
    } = toolbox;
    await commandSelector(toolbox, {
      parentCommand: 'server',
      welcome: 'Server commands'
    });
    return 'server';
  }
};
