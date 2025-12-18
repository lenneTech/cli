import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * MongoDB commands
 */
const command = {
  alias: ['mdb'],
  description: 'MongoDB commands',
  hidden: false,
  name: 'mongodb',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('mongodb', {
      headline: 'MongoDB Commands',
    });
  },
};

export default command;
