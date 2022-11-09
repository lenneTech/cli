import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Deployment commands
 */
module.exports = {
  name: 'deployment',
  alias: ['d'],
  description: 'Server commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('deployment');
    return 'deployment';
  },
};
