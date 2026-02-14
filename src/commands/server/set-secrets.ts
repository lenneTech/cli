import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Set secrets for the server configuration
 */
const NewCommand: GluegunCommand = {
  alias: ['scs'],
  description: 'Set server secrets',
  hidden: false,
  name: 'setConfigSecrets',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      parameters,
      patching,
      print: { error, info, spin },
      server,
    } = toolbox;

    // Check if file exists
    const filePath = parameters.first || 'src/config.env.ts';
    if (!filesystem.exists(filePath)) {
      info('');
      error(`There's no file named "${filePath}"`);
      return;
    }

    // Set secrets
    const prepareSpinner = spin(`Setting secrets in server configuration: ${filePath}`);
    await patching.update(filePath, (content) => server.replaceSecretOrPrivateKeys(content));
    prepareSpinner.succeed(`Secrets set in server configuration ${filePath}`);

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return 'secrets in server configuration set';
  },
};

export default NewCommand;
