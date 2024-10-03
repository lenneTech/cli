import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Angular commands
 */
module.exports = {
  alias: ['a'],
  description: 'Angular commands',
  hidden: true,
  name: 'angular',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('angular');
    return 'angular';
  },
};
