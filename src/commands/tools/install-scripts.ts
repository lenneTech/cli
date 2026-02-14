import { chmodSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Install all bash helper scripts to /usr/local/bin
 */
const NewCommand: GluegunCommand = {
  alias: ['is'],
  description: 'Install bash helper scripts',
  hidden: false,
  name: 'install-scripts',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      print: { error, info, spin, success },
      system: { run, startTimer },
    } = toolbox;

    // Start timer
    const timer = startTimer();

    const targetDir = '/usr/local/bin';

    // Check if target directory exists
    if (!existsSync(targetDir)) {
      error(`Target directory not found: ${targetDir}`);
      info('You may need to create it first: sudo mkdir -p /usr/local/bin');
      return 'install-scripts: target not found';
    }

    // Collect scripts from all subdirectories
    const baseDir = join(__dirname, '..', '..', 'templates', 'bash-scripts');
    const scriptDirs = ['tools'];
    const descriptions: Record<string, string> = {
      pcf: 'pnpm run check:fix (fallback: check)',
    };

    const installed: string[] = [];
    const failed: string[] = [];

    for (const dir of scriptDirs) {
      const sourceDir = join(baseDir, dir);

      if (!existsSync(sourceDir)) {
        continue;
      }

      const scripts = readdirSync(sourceDir).filter((file) => !file.startsWith('.'));

      for (const script of scripts) {
        const sourcePath = join(sourceDir, script);
        const targetPath = join(targetDir, script);
        const spinner = spin(`Installing ${script}`);

        try {
          copyFileSync(sourcePath, targetPath);
          chmodSync(targetPath, 0o755);
          spinner.succeed(`Installed ${script}`);
          installed.push(script);
        } catch (err) {
          spinner.fail(`Failed to install ${script}`);
          if (err.code === 'EACCES') {
            error(`  Permission denied. Try running with sudo: sudo lt tools install-scripts`);
          } else {
            error(`  ${err.message}`);
          }
          failed.push(script);
        }
      }
    }

    // Install git scripts
    info('');
    const gitSpinner = spin('Installing git scripts...');
    try {
      await run('lt git install-scripts');
      gitSpinner.succeed('Git scripts installed');
    } catch (err) {
      gitSpinner.fail('Failed to install git scripts');
      error(`  ${err.message}`);
      error('  Try running with sudo: sudo lt git install-scripts');
    }

    // Summary
    info('');
    if (failed.length === 0) {
      success(`All scripts installed in ${helper.msToMinutesAndSeconds(timer())}m.`);
    } else {
      error(`${installed.length} installed, ${failed.length} failed.`);
    }

    if (installed.length > 0) {
      info('');
      info('Installed scripts:');
      for (const script of installed) {
        const desc = descriptions[script] || 'run from anywhere in terminal';
        info(`  ${script} - ${desc}`);
      }
    }

    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return failed.length > 0 ? `scripts installed with ${failed.length} failures` : 'scripts installed';
  },
};

export default NewCommand;
