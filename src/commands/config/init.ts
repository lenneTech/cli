import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { LtConfig } from '../../interfaces/lt-config.interface';

/**
 * Initialize a new lt.config.json file
 */
const InitCommand: ExtendedGluegunCommand = {
  alias: ['i'],
  description: 'Initialize a new lt.config.json file in the current directory',
  hidden: false,
  name: 'init',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      parameters,
      print: { error, info, success },
      prompt: { ask, confirm },
    } = toolbox;

    // Check if config already exists
    const configPath = filesystem.path(filesystem.cwd(), 'lt.config.json');
    if (filesystem.exists(configPath)) {
      const overwrite = await confirm('lt.config.json already exists. Overwrite?', false);
      if (!overwrite) {
        info('Configuration initialization cancelled.');
        return;
      }
    }

    // Get configuration options from CLI or interactive mode
    const { controller, frontend, git: initGit, interactive = true } = parameters.options;

    const newConfig: LtConfig = {
      commands: {},
      meta: {
        version: '1.0.0',
      },
    };

    if (interactive) {
      // Interactive mode - ask for configuration
      info('Creating lt.config.json configuration...');
      info('');

      // Ask for server module configuration
      const serverConfig = await ask([
        {
          initial: true,
          message: 'Configure server module defaults?',
          name: 'configureServer',
          type: 'confirm',
        },
      ]);

      if (serverConfig.configureServer) {
        const serverOptions = await ask([
          {
            choices: ['Rest', 'GraphQL', 'Both', 'auto'],
            initial: 2, // Both
            message: 'Default controller type for new modules?',
            name: 'controller',
            type: 'select',
          },
          {
            initial: false,
            message: 'Skip lint by default?',
            name: 'skipLint',
            type: 'confirm',
          },
        ]);

        newConfig.commands.server = {
          addProp: {
            skipLint: serverOptions.skipLint as unknown as boolean,
          },
          module: {
            controller: serverOptions.controller as 'auto' | 'Both' | 'GraphQL' | 'Rest',
            skipLint: serverOptions.skipLint as unknown as boolean,
          },
          object: {
            skipLint: serverOptions.skipLint as unknown as boolean,
          },
        };
      }

      // Ask for fullstack configuration
      const fullstackConfig = await ask([
        {
          initial: false,
          message: 'Configure fullstack defaults?',
          name: 'configureFullstack',
          type: 'confirm',
        },
      ]);

      if (fullstackConfig.configureFullstack) {
        const fullstackOptions = await ask([
          {
            choices: ['angular', 'nuxt'],
            initial: 0,
            message: 'Default frontend framework?',
            name: 'frontend',
            type: 'select',
          },
          {
            initial: true,
            message: 'Initialize git by default?',
            name: 'git',
            type: 'confirm',
          },
        ]);

        newConfig.commands.fullstack = {
          frontend: fullstackOptions.frontend as 'angular' | 'nuxt',
          git: fullstackOptions.git as unknown as boolean,
        };
      }
    } else {
      // Non-interactive mode - use CLI parameters
      if (controller) {
        newConfig.commands.server = {
          module: {
            controller: controller as 'auto' | 'Both' | 'GraphQL' | 'Rest',
          },
        };
      }

      if (frontend) {
        newConfig.commands.fullstack = {
          frontend: frontend as 'angular' | 'nuxt',
          git: initGit !== undefined ? initGit === 'true' : undefined,
        };
      }
    }

    // Save configuration
    try {
      config.saveConfig(newConfig);
      info('');
      success('lt.config.json created successfully!');
      info('');
      info(`Configuration saved to: ${  configPath}`);
    } catch (e) {
      error(`Failed to create configuration file: ${  e.message}`);
    }

    return 'config init';
  },
};

export default InitCommand;
