import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Show help information about lt.config.json
 */
const HelpCommand: ExtendedGluegunCommand = {
  alias: ['h', 'info'],
  description: 'Show help information about lt.config.json usage',
  hidden: false,
  name: 'help',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      print: { divider, info },
    } = toolbox;

    divider();
    info('lt.config.json - Configuration File Help');
    divider();
    info('');

    info('📄 What is lt.config.json?');
    info('');
    info('The lt.config.json file allows you to configure default values for lenne.tech CLI commands.');
    info('This eliminates the need for repeated CLI parameters or interactive prompts.');
    info('');

    divider();
    info('📂 File Hierarchy');
    divider();
    info('');
    info('The CLI searches for lt.config.json files from the current directory up to the root directory.');
    info('Configuration files are merged with the following priority (lowest to highest):');
    info('');
    info('  1. Default values (hardcoded in CLI)');
    info('  2. Parent directory configs (root → current)');
    info('  3. Current directory config');
    info('  4. CLI parameters (--flag value)');
    info('  5. Interactive user input');
    info('');
    info('This means:');
    info('  • Configs in child directories override parent configs');
    info('  • CLI parameters override config file values');
    info('  • Interactive input overrides everything');
    info('');

    divider();
    info('📝 Configuration Structure');
    divider();
    info('');
    info('Example lt.config.json:');
    info('');
    info(JSON.stringify({
      commands: {
        fullstack: {
          frontend: 'angular',
          git: true,
        },
        server: {
          addProp: {
            skipLint: false,
          },
          module: {
            controller: 'Both',
            skipLint: false,
          },
          object: {
            skipLint: false,
          },
        },
      },
      meta: {
        description: 'Project description',
        name: 'My Project',
        version: '1.0.0',
      },
    }, null, 2));
    info('');

    divider();
    info('🔧 Available Configuration Options');
    divider();
    info('');

    info('Meta Information:');
    info('  meta.version          - Config file version');
    info('  meta.name             - Project name');
    info('  meta.description      - Project description');
    info('');

    info('Server Commands:');
    info('  commands.server.module.controller  - Default controller type (Rest|GraphQL|Both|auto)');
    info('  commands.server.module.skipLint    - Skip lint after module creation (boolean)');
    info('  commands.server.object.skipLint    - Skip lint after object creation (boolean)');
    info('  commands.server.addProp.skipLint   - Skip lint after adding property (boolean)');
    info('');

    info('Fullstack Commands:');
    info('  commands.fullstack.frontend        - Default frontend framework (angular|nuxt)');
    info('  commands.fullstack.git             - Initialize git by default (boolean)');
    info('');

    divider();
    info('💡 Usage Examples');
    divider();
    info('');

    info('1. Initialize a new config:');
    info('   $ lt config init');
    info('');

    info('2. Show current merged config:');
    info('   $ lt config show');
    info('');

    info('3. Create module using config defaults:');
    info('   $ lt server module --name Product');
    info('   (uses controller type from config)');
    info('');

    info('4. Override config with CLI parameter:');
    info('   $ lt server module --name Product --controller Rest');
    info('   (ignores config, uses Rest)');
    info('');

    info('5. Hierarchical config example:');
    info('');
    info('   /projects/lt.config.json:           ← Parent config');
    info('   {');
    info('     "commands": {');
    info('       "server": {');
    info('         "module": { "controller": "Both" }');
    info('       }');
    info('     }');
    info('   }');
    info('');
    info('   /projects/api/lt.config.json:       ← Child config (overrides parent)');
    info('   {');
    info('     "commands": {');
    info('       "server": {');
    info('         "module": { "controller": "Rest" }');
    info('       }');
    info('     }');
    info('   }');
    info('');
    info('   When running "lt server module" in /projects/api/:');
    info('   → Uses "Rest" (child config overrides parent)');
    info('');

    divider();
    info('🚀 Quick Start');
    divider();
    info('');

    info('1. Navigate to your project root:');
    info('   $ cd /path/to/project');
    info('');

    info('2. Initialize config:');
    info('   $ lt config init');
    info('');

    info('3. Edit lt.config.json to your needs');
    info('');

    info('4. Run commands without repeated parameters:');
    info('   $ lt server module --name User');
    info('   $ lt server module --name Product');
    info('   (both use the same controller type from config)');
    info('');

    divider();
    info('');

    info('For more information, visit:');
    info('https://github.com/lenneTech/cli');
    info('');

    return 'config help';
  },
};

export default HelpCommand;
