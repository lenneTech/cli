import { GluegunCommand } from 'gluegun';
import { dirname } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { hasCmdShimHazard, spawnArgs } from '../../lib/exec-args';

/**
 * Rename current CLI
 */
const NewCommand: GluegunCommand = {
  alias: ['r'],
  description: 'Rename current CLI',
  hidden: false,
  name: 'rename',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      npm,
      parameters,
      print: { error, info },
    } = toolbox;

    // Info
    info('Rename current CLI');

    // Get root path
    const { path: packagePath } = await npm.getPackageJson();
    if (!packagePath) {
      error('The path to the root directory could not be found.');
      return;
    }
    const rootPath = dirname(packagePath);
    if (!rootPath) {
      error('The path to the root directory could not be found.');
      return;
    }

    // Run rename script
    // Argument list, no shell: the arguments are passed through from the command line (see exec-args.ts).
    const renameArgs = (parameters.array || []).map(String);
    if (renameArgs.some((value) => hasCmdShimHazard(value))) {
      error('Arguments must not contain ", % or line breaks on Windows.');
      return;
    }
    const [runner, ...runArgs] = toolbox.pm.run('rename', toolbox.pm.detect(rootPath)).split(' ');
    await spawnArgs(runner, [...runArgs, '--', ...renameArgs], { cwd: rootPath });

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `renamed cli in ${rootPath}`;
  },
};

export default NewCommand;
