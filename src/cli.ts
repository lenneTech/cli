import { build } from 'gluegun';
import { join } from 'path';

import { installHelpInterceptor } from './lib/command-help';

/**
 * Create the cli and kick it off
 */
async function run(argv) {
  try {
    // Create a CLI runtime
    const cli = build()
      .brand('lt')
      .src(__dirname)
      // .plugins('./node_modules', { matching: 'lt-*', hidden: true })
      .plugin(join(__dirname, '..', 'node_modules', '@lenne.tech', 'cli-plugin-helper', 'dist'), {
        commandFilePattern: ['*.js'],
        extensionFilePattern: ['*.js'],
      })
      .help() // provides default for top-level help, h, --help, -h
      .version() // provides default for version, v, --version, -v
      .create();

    // Generic per-command `--help` / `-h`: gluegun's `.help()` only covers the
    // top level, so without this a subcommand like `lt fullstack convert-mode
    // --help` would actually RUN. The interceptor makes every command print
    // help and return without executing when help is requested.
    installHelpInterceptor(cli.commands, cli.defaultCommand);

    // Run cli
    const toolbox = await cli.run(argv);

    // Record command in history (if history extension is available)
    if (toolbox?.history && toolbox.commandName && !['completion', 'history'].includes(toolbox.commandName)) {
      try {
        const args = argv.slice(1); // Remove the command name
        toolbox.history.addEntry(toolbox.commandName, args);
      } catch {
        // Ignore history errors
      }
    }

    // Send it back (for testing, mostly)
    return toolbox;
  } catch (e) {
    // Abort via CTRL-C
    if (!e) {
      // eslint-disable-next-line no-console
      console.log('Goodbye ✌️');
    } else {
      // Throw error
      throw e;
    }
  }
}

module.exports = { run };
