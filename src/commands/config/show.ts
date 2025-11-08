import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Show current configuration (merged from all lt.config.json files)
 */
const ShowCommand: ExtendedGluegunCommand = {
  alias: ['s'],
  description: 'Show current configuration (merged from all lt.config.json files in hierarchy)',
  hidden: false,
  name: 'show',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      print: { divider, info },
    } = toolbox;

    info('Loading configuration from lt.config.json files...');
    info('');

    // Load merged configuration
    const mergedConfig = config.loadConfig();

    if (!mergedConfig || Object.keys(mergedConfig).length === 0) {
      info('No configuration found.');
      info('Run "lt config init" to create a new configuration file.');
      return 'config show';
    }

    divider();
    info('Merged Configuration:');
    divider();

    // Display configuration as JSON
    info(JSON.stringify(mergedConfig, null, 2));

    divider();
    info('');

    // Show which config files were found
    info('Configuration files in hierarchy:');
    let currentPath = filesystem.cwd();
    const root = filesystem.separator === '/' ? '/' : /^[A-Z]:\\$/i;
    const foundConfigs: string[] = [];

    while (true) {
      const configPath = filesystem.path(currentPath, 'lt.config.json');
      if (filesystem.exists(configPath)) {
        foundConfigs.push(configPath);
      }

      const parent = filesystem.path(currentPath, '..');
      if (parent === currentPath || (typeof root !== 'string' && root.test(currentPath))) {
        break;
      }
      currentPath = parent;
    }

    if (foundConfigs.length > 0) {
      foundConfigs.reverse(); // Show from root to current
      foundConfigs.forEach((path, index) => {
        info(`  ${index + 1}. ${path}`);
      });
    } else {
      info('  (none)');
    }

    info('');

    return 'config show';
  },
};

export default ShowCommand;
