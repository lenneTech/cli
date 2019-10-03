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
    await toolbox.helper.showMenu('git');
    return 'git';
  }
};
