import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

const command = {
  description: 'Commands for interacting with Qdrant',
  name: 'qdrant',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('qdrant', {
      headline: 'Qdrant Commands',
    });
  },
};

export default command;
