import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Templates commands
 */
module.exports = {
  alias: ['tpl'],
  description: 'Template commands for LLM prompts and more',
  hidden: false,
  name: 'templates',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('templates');
    return 'templates';
  },
};
