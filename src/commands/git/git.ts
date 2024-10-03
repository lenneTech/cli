import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Git commands
 */
module.exports = {
  alias: ['g'],
  description: 'Git commands',
  hidden: true,
  name: 'git',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('git');
    return 'git';
  },
};
