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
      helper,
      print: { spin },
      prompt: { ask },
      strings: { kebabCase },
      system,
    } = toolbox;


    const projName = (
      await ask({
        message: 'What is the project\'s name?',
        name: 'projectName',
        required: true,
        type: 'input',
      })
    ).projectName;

    // Start timer
    const timer = system.startTimer();

    const baseSpinner = spin(`Creating nuxt-base with name '${kebabCase(projName)}'`);

    await system.run(`npx create-nuxt-base '${kebabCase(projName)}'`);


    baseSpinner.succeed(`Successfully created nuxt workspace with name '${kebabCase(projName)}' in ${helper.msToMinutesAndSeconds(
      timer(),
    )}m.`);

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return `created nuxt workspace ${kebabCase(projName)}`;
  },
};

export default NewCommand;
