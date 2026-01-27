import { execSync } from 'child_process';
import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * Get the version that a new CLI process would use by running 'lt --version'.
 * This is the most reliable way to check if the update was successful,
 * as it tests the actual behavior of a new process.
 */
function getNewProcessVersion(): null | string {
  try {
    const result = execSync('lt --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Update @lenne.tech/cli
 */
const NewCommand: GluegunCommand = {
  alias: ['up'],
  description: 'Update @lenne.tech/cli',
  hidden: false,
  name: 'update',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      helper,
      meta,
      print: { info, warning },
      runtime: { brand },
    } = toolbox;

    // Store version before update
    const versionBefore = meta.version();

    // Update cli and show process
    await helper.updateCli({ showInfos: true });

    // Check what version a new process would use
    const newProcessVersion = getNewProcessVersion();

    // Check if update was successful and version changed
    if (newProcessVersion && newProcessVersion !== versionBefore) {
      info('');
      info(`Update successful: ${versionBefore} → ${newProcessVersion}`);
      info('');
      const shell = process.env.SHELL || '';
      if (shell.includes('zsh')) {
        info(`To use the new version, run 'rehash' or open a new terminal.`);
      } else if (shell.includes('bash')) {
        info(`To use the new version, run 'hash -r' or open a new terminal.`);
      } else {
        info(`To use the new version, open a new terminal.`);
      }
    } else if (newProcessVersion === versionBefore) {
      info('');
      info(`CLI is already up to date (${versionBefore}).`);
    } else {
      // Could not verify update
      warning('');
      warning(`Could not verify update. Please run 'lt --version' to check.`);
    }

    // For tests
    return `updated ${brand}`;
  },
};

export default NewCommand;
