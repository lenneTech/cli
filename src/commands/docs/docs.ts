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
    const {
      helper: { commandSelector }
    } = toolbox;
    await commandSelector(toolbox, { parentCommand: 'docs' });
    return 'docs';
  }
};
