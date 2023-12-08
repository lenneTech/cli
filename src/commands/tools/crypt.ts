import { GluegunCommand } from 'gluegun';
import { sha256 } from 'js-sha256';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import bcrypt = require('bcrypt');

/**
 * Open regex tools in browser
 */
const NewCommand: GluegunCommand = {
  name: 'crypt',
  alias: ['c', 'p', 'bcrypt', 'password'],
  description: 'Generate a password hash with bcrypt as in nest-server',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      print: { info, error },
      parameters,
    } = toolbox;
    
    let password = await helper.getInput(parameters.first, {
      name: 'password to crypt',
      showError: false,
    });
    
    if (!password) {
      error('No password provided');
      return;
    }
    
    // Check if the password was transmitted encrypted
    // If not, the password is encrypted to enable future encrypted and unencrypted transmissions
    if (!/^[a-f0-9]{64}$/i.test(password)) {
      password = sha256(password);
    }
    
    // Hash password
    password = await bcrypt.hash(password, 10);
    info(password);
    
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }
    
    // For tests
    return `crypt`;
  },
};

export default NewCommand;
