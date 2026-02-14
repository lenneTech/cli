import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Open regex tools in browser
 */
const NewCommand: GluegunCommand = {
  alias: ['r'],
  description: 'Open regex tools in browser',
  hidden: false,
  name: 'regex',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { default: open } = await import('open');

    // Open link
    await open('https://regex101.com');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return 'open regex';
  },
};

export default NewCommand;
