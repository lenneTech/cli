import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { LtConfig } from '../../interfaces/lt-config.interface';

/**
 * Initialize a new lt.config file
 */
const InitCommand: ExtendedGluegunCommand = {
  alias: ['i'],
  description: 'Initialize lt.config file',
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

    // Load configuration
    const ltConfig = config.loadConfig();

    // Determine noConfirm with priority: CLI > command > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.config?.init,
      config: ltConfig,
    });

    // Check for existing config files
    const cwd = filesystem.cwd();
    const configFiles = ['lt.config.json', 'lt.config.yaml', 'lt.config'];
    const existingConfig = configFiles.find((f) => filesystem.exists(filesystem.path(cwd, f)));

    if (existingConfig) {
      if (!noConfirm) {
        const overwrite = await confirm(`${existingConfig} already exists. Overwrite?`, false);
        if (!overwrite) {
          info('Configuration initialization cancelled.');
          return;
        }
      }
      // Remove existing config file before creating new one
      filesystem.remove(filesystem.path(cwd, existingConfig));
    }

    // Get configuration options from CLI or interactive mode
    const { controller, format: cliFormat, frontend, git: initGit, interactive = true } = parameters.options;

    const newConfig: LtConfig = {
      commands: {},
      meta: {
        version: '1.0.0',
      },
    };

    let format: 'json' | 'yaml' = 'json';

    if (interactive) {
      // Interactive mode - ask for configuration
      info('Creating lt.config configuration...');
      info('');

      // Ask for file format
      const formatChoice = await ask([
        {
          choices: ['json', 'yaml'],
          initial: 0,
          message: 'Configuration file format?',
          name: 'format',
          type: 'select',
        },
      ]);
      format = formatChoice.format as 'json' | 'yaml';

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
            initial: 1, // nuxt
            message: 'Default frontend framework?',
            name: 'frontend',
            type: 'select',
          },
          {
            initial: false,
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
      format = cliFormat === 'yaml' ? 'yaml' : 'json';

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
      config.saveConfig(newConfig, cwd, { format });
      const fileName = format === 'yaml' ? 'lt.config.yaml' : 'lt.config.json';
      const configPath = filesystem.path(cwd, fileName);

      info('');
      success(`${fileName} created successfully!`);
      info('');
      info(`Configuration saved to: ${configPath}`);
    } catch (e) {
      error(`Failed to create configuration file: ${e.message}`);
      return 'config init: failed';
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return 'config init';
  },
};

export default InitCommand;
