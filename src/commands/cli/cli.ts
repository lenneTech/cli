import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * CLI commands
 */
module.exports = {
  name: 'cli',
  alias: ['c'],
  description: 'Commands to create a CLI',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox;
    await commandSelector(toolbox, {
      parentCommand: 'cli',
      welcome: 'CLI commands'
    });
    return 'cli';
  }
};
