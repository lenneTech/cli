import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * TypeScript commands
 */
module.exports = {
  alias: ['ts'],
  description: 'Typescript commands',
  hidden: true,
  name: 'typescript',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('typescript', { headline: 'TypeScript commands' });
    return 'typescript';
  },
};
