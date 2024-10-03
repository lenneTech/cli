import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Npm commands
 */
module.exports = {
  alias: ['n'],
  description: 'Npm commands',
  hidden: true,
  name: 'npm',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('npm');
    return 'npm';
  },
};
