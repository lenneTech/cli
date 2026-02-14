import { GluegunCommand } from 'gluegun';
import { sha256 } from 'js-sha256';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Open regex tools in browser
 */
const NewCommand: GluegunCommand = {
  alias: ['h', 'hash'],
  description: 'Hash a string with sha256',
  hidden: false,
  name: 'sha256',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      parameters,
      print: { info },
    } = toolbox;

    const input = await helper.getInput(parameters.first, {
      name: 'string to hash',
      showError: false,
    });
    const hashResult = await sha256(input);
    info(hashResult);

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return 'sha256';
  },
};

export default NewCommand;
