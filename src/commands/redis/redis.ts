import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

const command = {
  description: 'Commands for interacting with Redis',
  name: 'redis',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('redis', {
      headline: 'Redis Commands',
    });
  },
};

export default command;
