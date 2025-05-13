import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Open documentations
 */
const NewCommand: GluegunCommand = {
  alias: ['o'],
  description: 'Open documentation',
  hidden: false,
  name: 'open',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      helper,
      parameters,
      print: { error },
      prompt: { ask },
    } = toolbox;

    const { default: open } = await import('open');

    const choices = ['lenne.Tech', 'NestJS', 'GlueGun'];

    // Get input
    let input = await helper.getInput(parameters.first, {
      name: 'doc',
      showError: true,
    });
    if (!input || !choices.includes(input)) {
      // Select type
      const { type } = await ask({
        choices: choices.slice(0),
        message: 'Select',
        name: 'type',
        type: 'select',
      });
      input = type;
    }

    switch (input) {
      case choices[0]: {
        await open('http://lenne.tech');
        break;
      }
      case choices[1]: {
        await open('https://docs.nestjs.com/');
        break;
      }
      case choices[2]: {
        await open('https://infinitered.github.io/gluegun/#/?id=quick-start');
        break;
      }
      default: {
        error(`${input} not found!`);
        return;
      }
    }

    // For tests
    return 'docs open';
  },
};

export default NewCommand;
