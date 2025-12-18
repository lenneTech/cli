import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new branch
 */
const NewCommand: GluegunCommand = {
  alias: ['pg'],
  description: 'Create TS playground',
  hidden: false,
  name: 'playground',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      print: { error },
      prompt: { ask },
      typescript,
    } = toolbox;

    const choices = ['StackBlitz (online)', 'Web-Maker (download)', 'Simple typescript project'];

    // Select type
    const { type } = await ask({
      choices: choices.slice(0),
      message: 'Select',
      name: 'type',
      type: 'select',
    });

    switch (type) {
      case choices[0]: {
        await typescript.stackblitz();
        break;
      }
      case choices[1]: {
        await typescript.webmaker();
        break;
      }
      case choices[2]: {
        await typescript.create();
        break;
      }
      default: {
        error(`No option selected!${type}`);
        return;
      }
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return 'typescript';
  },
};

export default NewCommand;
