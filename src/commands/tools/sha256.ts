import { GluegunCommand } from 'gluegun';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { sha256 } from 'js-sha256';

/**
 * Open regex tools in browser
 */
const NewCommand: GluegunCommand = {
  name: 'sha256',
  alias: ['h', 'hash'],
  description: 'Hash a string with sha256',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      print: { info },
      parameters,
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
    return `sha256`;
  },
};

export default NewCommand;
