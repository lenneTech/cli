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
    const {
      helper: { commandSelector }
    } = toolbox;
    await commandSelector(toolbox, { parentCommand: 'tools' });
    return 'tools';
  }
};
