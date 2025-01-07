import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Frontend commands
 */
module.exports = {
  alias: ['f'],
  description: 'Frontend commands',
  hidden: true,
  name: 'frontend',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('frontend');
    return 'frontend';
  },
};
