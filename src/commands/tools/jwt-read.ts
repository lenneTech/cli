import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Parse a JWT and show the payload
 */
const NewCommand: GluegunCommand = {
  alias: ['jr'],
  description: 'Parse a JWT and show the payload',
  hidden: false,
  name: 'jwt-read',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      parameters,
      print: { error, info },
    } = toolbox;
    
    const jwt = await helper.getInput(parameters.first, {
      name: 'JWT to parse',
      showError: false,
    });
    
    if (!jwt) {
      error('No JWT provided');
      return;
    }
    
    // Hash password
    const data = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
    info(data);
    if (data.iat) {
      info(`iat: ${new Date(data.iat * 1000)}`);
    }
    if (data.exp) {
      info(`exp: ${new Date(data.exp * 1000)}`);
    }
    
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }
    
    // For tests
    return 'jwt-read';
  },
};

export default NewCommand;
