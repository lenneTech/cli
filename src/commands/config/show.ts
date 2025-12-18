import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Show current configuration (merged from all lt.config files)
 */
const ShowCommand: ExtendedGluegunCommand = {
  alias: ['s'],
  description: 'Show merged configuration',
  hidden: false,
  name: 'show',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      parameters,
      print: { colors, divider, info },
    } = toolbox;

    const showOrigins = parameters.options.origins || parameters.options.o;

    info('Loading configuration from lt.config files...');
    info('');

    // Load merged configuration with origins
    const { config: mergedConfig, files, origins } = config.loadConfigWithOrigins();

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
    info('Configuration files in hierarchy (from root to current):');

    if (files.length > 0) {
      files.forEach((file, index) => {
        const priority = index === files.length - 1 ? ' (highest priority)' : '';
        info(`  ${index + 1}. ${file.path}${priority}`);
      });
    } else {
      info('  (none)');
    }

    // Show value origins if requested
    if (showOrigins && origins.size > 0) {
      info('');
      divider();
      info('Value Origins:');
      divider();

      // Sort origins by key path for readable output
      const sortedOrigins = Array.from(origins.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      for (const [keyPath, filePath] of sortedOrigins) {
        // Get the actual value from merged config
        const value = getValueByPath(mergedConfig, keyPath);
        const valueStr = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
        info(`  ${colors.cyan(keyPath)}: ${valueStr}`);
        info(`    ${colors.muted('from')} ${filePath}`);
      }
    }

    info('');
    info('Priority: CLI parameters > config files > interactive input');
    if (!showOrigins) {
      info('');
      info(`Tip: Use ${colors.cyan('--origins')} to see where each value comes from.`);
    }
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return 'config show';
  },
};

/**
 * Get a value from an object by dot-separated path
 */
function getValueByPath(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export default ShowCommand;
