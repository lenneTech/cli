import { chmodSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Install git helper scripts to /usr/local/bin
 */
const NewCommand: GluegunCommand = {
  alias: ['is'],
  description: 'Install git helper scripts',
  hidden: false,
  name: 'install-scripts',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      print: { error, info, spin, success },
      system: { startTimer },
    } = toolbox;

    // Start timer
    const timer = startTimer();

    // Source directory (relative to built CLI)
    const sourceDir = join(__dirname, '..', '..', 'templates', 'bash-scripts', 'git');
    const targetDir = '/usr/local/bin';

    // Check if source directory exists
    if (!existsSync(sourceDir)) {
      error(`Source directory not found: ${sourceDir}`);
      return process.exit(1);
    }

    // Check if target directory exists
    if (!existsSync(targetDir)) {
      error(`Target directory not found: ${targetDir}`);
      info('You may need to create it first: sudo mkdir -p /usr/local/bin');
      return process.exit(1);
    }

    // Get all script files
    const scripts = readdirSync(sourceDir).filter(file => !file.startsWith('.'));

    if (scripts.length === 0) {
      error('No scripts found to install.');
      return process.exit(1);
    }

    info(`Installing ${scripts.length} script${scripts.length > 1 ? 's' : ''} to ${targetDir}...`);
    info('');

    const installed: string[] = [];
    const failed: string[] = [];

    for (const script of scripts) {
      const sourcePath = join(sourceDir, script);
      const targetPath = join(targetDir, script);
      const spinner = spin(`Installing ${script}`);

      try {
        // Copy file
        copyFileSync(sourcePath, targetPath);

        // Set executable permissions (rwxr-xr-x = 0o755)
        chmodSync(targetPath, 0o755);

        spinner.succeed(`Installed ${script}`);
        installed.push(script);
      } catch (err) {
        spinner.fail(`Failed to install ${script}`);
        if (err.code === 'EACCES') {
          error(`  Permission denied. Try running with sudo: sudo lt git install-scripts`);
        } else {
          error(`  ${err.message}`);
        }
        failed.push(script);
      }
    }

    // Summary
    info('');
    if (failed.length === 0) {
      success(`${installed.length} script${installed.length > 1 ? 's' : ''} installed in ${helper.msToMinutesAndSeconds(timer())}m.`);
    } else {
      error(`${installed.length} installed, ${failed.length} failed.`);
    }

    if (installed.length > 0) {
      info('');
      info('Installed scripts:');
      const descriptions: Record<string, string> = {
        gitget: 'lt git get - checkout branch',
        gitgets: 'lt git get + npm start',
        gitgett: 'lt git get + lint + test + test:e2e',
      };
      for (const script of installed) {
        const desc = descriptions[script] || 'run from anywhere in terminal';
        info(`  ${script} - ${desc}`);
      }
    }

    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit(failed.length > 0 ? 1 : 0);
    }

    return 'scripts installed';
  },
};

export default NewCommand;
