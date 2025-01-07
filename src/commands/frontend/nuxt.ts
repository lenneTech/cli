import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new nuxt workspace
 */
const NewCommand: GluegunCommand = {
  alias: ['n'],
  description: 'Creates a new nuxt workspace',
  hidden: false,
  name: 'nuxt',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      print: { spin },
      prompt: { ask },
      strings: { pascalCase },
      system,
    } = toolbox;


    const projName = (
      await ask({
        message: 'What is the project\'s name?',
        name: 'projectName',
        type: 'input',
      })
    ).projectName;

    const baseSpinner = spin(`Creating nuxt-base with name '${pascalCase(projName)}'`);

    await system.run(`npx create-nuxt-base '${pascalCase(projName)}'`);

    baseSpinner.succeed(`Successfully created nuxt workspace with name '${pascalCase(projName)}'`);

  },
};

export default NewCommand;
