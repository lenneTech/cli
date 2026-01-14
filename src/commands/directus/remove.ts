import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Remove a Directus Docker instance
 */
const NewCommand: GluegunCommand = {
  alias: ['rm'],
  description: 'Remove Directus instance',
  hidden: false,
  name: 'remove',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      parameters,
      print: { error, info, spin, success, warning },
      prompt,
      system,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();

    // Determine noConfirm
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.directus?.remove,
      config: ltConfig,
    });

    // Get instance name from argument or prompt
    const cliName = parameters.first;
    let instanceName: string;

    const directusBaseDir = join(filesystem.homedir(), '.lt', 'directus');

    // Check if directus directory exists
    if (!filesystem.exists(directusBaseDir)) {
      error('No Directus instances found.');
      return;
    }

    // Get list of existing instances
    const instances = filesystem
      .list(directusBaseDir)
      ?.filter((item) => filesystem.isDirectory(join(directusBaseDir, item))) || [];

    if (instances.length === 0) {
      error('No Directus instances found.');
      return;
    }

    if (cliName) {
      instanceName = cliName;
    } else if (noConfirm) {
      error('Instance name is required (provide as first argument)');
      return;
    } else {
      // Show available instances for selection
      info('Available instances:');
      instances.forEach((instance) => {
        info(`  - ${instance}`);
      });
      info('');

      const nameResponse = await prompt.ask<{ name: string }>({
        message: 'Enter instance name to remove:',
        name: 'name',
        type: 'input',
      });
      instanceName = nameResponse.name;
    }

    if (!instanceName) {
      error('Instance name is required!');
      return;
    }

    const instanceDir = join(directusBaseDir, instanceName);

    // Check if instance exists
    if (!filesystem.exists(instanceDir)) {
      error(`Instance "${instanceName}" not found.`);
      info('Available instances:');
      instances.forEach((instance) => {
        info(`  - ${instance}`);
      });
      return;
    }

    // Confirm deletion
    if (!noConfirm) {
      warning(`This will permanently delete instance "${instanceName}" and all its data!`);
      const shouldDelete = await prompt.confirm('Are you sure you want to continue?');
      if (!shouldDelete) {
        info('Operation cancelled.');
        return;
      }
    }

    // Stop and remove containers
    const composePath = join(instanceDir, 'docker-compose.yml');
    if (filesystem.exists(composePath)) {
      const stopSpin = spin('Stopping and removing containers');
      try {
        await system.run(`cd ${instanceDir} && docker-compose down -v`);
        stopSpin.succeed();
      } catch (stopError) {
        stopSpin.fail('Failed to stop containers');
        if (stopError instanceof Error) {
          warning(stopError.message);
        }
        warning('Continuing with directory removal...');
      }
    }

    // Remove instance directory
    const removeSpin = spin('Removing instance directory');
    try {
      filesystem.remove(instanceDir);
      removeSpin.succeed();
    } catch (removeError) {
      removeSpin.fail('Failed to remove instance directory');
      if (removeError instanceof Error) {
        error(removeError.message);
      }
      return;
    }

    success(`Instance "${instanceName}" removed successfully!`);

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `removed directus instance ${instanceName}`;
  },
};

export default NewCommand;
