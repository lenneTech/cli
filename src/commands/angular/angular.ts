import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Angular commands
 */
module.exports = {
  name: 'angular',
  alias: ['a'],
  description: 'Angular commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('angular');
    return 'angular';
  },
};
