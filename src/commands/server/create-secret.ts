import * as crypto from 'crypto';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Open regex tools in browser
 */
const NewCommand: GluegunCommand = {
  alias: ['cs'],
  description: 'Generate secret string',
  hidden: false,
  name: 'createSecret',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      parameters,
      print: { success },
    } = toolbox;
    success(crypto.randomBytes(512).toString('base64'));

    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return 'secret created';
  },
};

export default NewCommand;
