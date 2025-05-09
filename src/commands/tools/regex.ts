import { GluegunCommand } from 'gluegun';
import { default as open } from 'open';

/**
 * Open regex tools in browser
 */
const NewCommand: GluegunCommand = {
  alias: ['r'],
  description: 'Open regex tools in browser',
  hidden: false,
  name: 'regex',
  run: async () => {
    // Open link
    await open('https://regex101.com');

    // For tests
    return 'open regex';
  },
};

export default NewCommand;
