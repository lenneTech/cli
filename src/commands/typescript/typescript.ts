import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * TypeScript commands
 */
module.exports = {
  name: 'typescript',
  alias: ['ts'],
  description: 'Typescript commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu('typescript', { headline: 'TypeScript commands' });
    return 'typescript';
  }
};
