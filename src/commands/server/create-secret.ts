import * as crypto from 'crypto';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Open regex tools in browser
 */
const NewCommand: GluegunCommand = {
  alias: ['cs'],
  description: 'Create a new secret string (for JWT config)',
  hidden: false,
  name: 'createSecret',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      print: { success },
    } = toolbox;
    success(crypto.randomBytes(512).toString('base64'));

    // For tests
    return 'secret created';
  },
};

export default NewCommand;
