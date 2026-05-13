import { existsSync, unlinkSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { paths as caddyPaths } from '../../lib/caddy';
import { getServicePaths, platformSupported, uninstallService } from '../../lib/dev-service';

/**
 * Symmetric counterpart to `lt dev install`.
 *
 * Removes the LaunchAgent / systemd-user unit, stops the running Caddy
 * daemon, and optionally purges all lt-dev state (Caddyfile, logs).
 *
 * What it does NOT touch:
 *   - the caddy binary itself (`brew uninstall caddy` remains the
 *     user's choice — we don't presume they want to drop the tool)
 *   - per-project state under `<project>/.lt-dev/` (use `lt dev down`)
 *   - the trusted CA in the system keychain (use
 *     `sudo -E HOME="$HOME" caddy untrust` if desired)
 *
 * Flags:
 *   --purge      — also remove ~/.lenneTech/Caddyfile and caddy logs
 *   --noConfirm  — skip the purge confirmation prompt
 */
const UninstallCommand: GluegunCommand = {
  alias: ['un'],
  description: 'Remove lt dev Caddy service',
  hidden: false,
  name: 'uninstall',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      parameters,
      print: { colors, error, info, success, warning },
      prompt: { confirm },
    } = toolbox;

    info('');
    info(colors.bold('lt dev uninstall — remove the lt-dev Caddy service'));
    info(colors.dim('─'.repeat(60)));

    const plat = platformSupported();
    if (plat === 'unsupported') {
      info('No managed service to remove on this platform.');
      if (!parameters.options.fromGluegunMenu) process.exit(0);
      return 'dev uninstall: nothing to do';
    }

    const paths = getServicePaths();
    const result = await uninstallService();
    if (!result.ok) {
      error(result.message);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev uninstall: failed';
    }

    if (result.removed.length === 0) {
      info(colors.dim('Service was not installed.'));
    } else {
      success(`Removed: ${result.removed.join(', ')}`);
    }

    // Optional purge of related state files.
    const purge =
      Boolean(parameters.options.purge) ||
      (!parameters.options.noConfirm && (await confirm('Also remove the Caddyfile and lt-dev caddy logs?', false)));

    if (purge) {
      const toRemove = [caddyPaths.caddyfile, paths.logFile, paths.errFile, join(paths.logFile, '..', 'ports.json')];
      for (const file of toRemove) {
        if (existsSync(file)) {
          try {
            unlinkSync(file);
            success(`Removed ${file}`);
          } catch (e) {
            warning(`Failed to remove ${file}: ${(e as Error).message}`);
          }
        }
      }
    } else {
      info(colors.dim(`Kept: ${caddyPaths.caddyfile}`));
      info(colors.dim(`Kept: ${paths.logFile}`));
    }

    info('');
    info(
      `To reinstall: ${colors.cyan('lt dev install')}. To also remove caddy itself: ${colors.cyan('brew uninstall caddy')}.`,
    );
    if (!parameters.options.fromGluegunMenu) process.exit(0);
    return 'dev uninstall: ok';
  },
};

module.exports = UninstallCommand;
