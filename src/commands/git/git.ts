import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Git commands
 */
module.exports = {
  name: 'git',
  alias: ['g'],
  description: 'Git commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox;
    await commandSelector(toolbox, { parentCommand: 'git' });
    return 'git';
  }
};
