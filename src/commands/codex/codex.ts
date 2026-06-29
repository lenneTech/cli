import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Codex commands
 */
module.exports = {
  alias: ['cx'],
  description: 'Codex commands',
  name: 'codex',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('codex');
    return 'codex';
  },
};
