import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Deployment commands
 */
module.exports = {
  alias: ['dp'],
  description: 'Server commands',
  hidden: true,
  name: 'deployment',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('deployment');
    return 'deployment';
  },
};
