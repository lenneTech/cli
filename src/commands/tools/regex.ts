import { GluegunCommand } from 'gluegun';
import * as open from 'open';

/**
 * Open regex tools in browser
 */
const NewCommand: GluegunCommand = {
  name: 'regex',
  alias: [],
  description: 'Open regex tools in browser',
  hidden: false,
  run: async () => {
    // Open link
    await open('https://regex101.com');

    // For tests
    return `open regex`;
  },
};

export default NewCommand;
