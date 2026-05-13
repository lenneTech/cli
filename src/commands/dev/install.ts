import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, paths as caddyPaths, validateCaddyfile, writeCaddyfile } from '../../lib/caddy';
import {
  getServicePaths,
  getServiceStatus,
  installService,
  platformSupported,
  waitForServiceReady,
} from '../../lib/dev-service';

/**
 * One-time per-machine setup for `lt dev`.
 *
 * Owns the full Caddy lifecycle through a dedicated LaunchAgent
 * (macOS) / systemd-user unit (Linux). This intentionally bypasses
 * `brew services caddy`, whose plist hardcodes
 * `--config /opt/homebrew/etc/Caddyfile` and would crash-loop against
 * our `~/.lenneTech/Caddyfile` location — which is the bug that
 * blocked the first real install.
 *
 * Steps (each idempotent — safe to re-run):
 *   1. Verify `caddy` is on PATH (suggest install instructions otherwise)
 *   2. Ensure `~/.lenneTech/Caddyfile` exists (stub written if missing)
 *   3. Detect conflicting `brew services caddy` and tell the user to
 *      stop it — it would fight us for ports 80/443
 *   4. Install + bootstrap our LaunchAgent/systemd unit
 *   5. Wait for the Caddy admin endpoint to respond
 *   6. Validate the Caddyfile
 *   7. Surface the `sudo -E HOME="$HOME" caddy trust` instruction for
 *      installing the local CA (HOME must survive sudo so caddy can
 *      find its CA files under the *user* profile, not /var/root)
 */
const InstallCommand: GluegunCommand = {
  alias: ['i'],
  description: 'Setup Caddy service for lt dev',
  hidden: false,
  name: 'install',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      parameters,
      print: { colors, error, info, success, warning },
    } = toolbox;

    info('');
    info(colors.bold('lt dev install — one-time per-machine setup'));
    info(colors.dim('─'.repeat(60)));

    const plat = platformSupported();
    if (plat === 'unsupported') {
      error(`Service management is not supported on ${process.platform}. Only macOS and Linux are covered.`);
      info(`  Workaround: run \`${colors.cyan(`caddy run --config ${caddyPaths.caddyfile}`)}\` manually.`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'dev install: unsupported platform';
    }

    let blocked = false;

    // 1. caddy on PATH
    const hasCaddy = await caddyAvailable();
    if (hasCaddy) {
      success('caddy is on PATH');
    } else {
      warning('caddy is not installed.');
      info(`  → macOS: ${colors.cyan('brew install caddy')}`);
      info(`  → Linux: ${colors.cyan('https://caddyserver.com/docs/install')}`);
      info('  (Do NOT start it via `brew services` — `lt dev install` runs its own service.)');
      blocked = true;
    }

    // 2. Caddyfile stub
    writeCaddyfile('# lt dev — managed Caddyfile\n# Add per-project blocks via `lt dev up`.\n');
    success(`Caddyfile present at ${caddyPaths.caddyfile}`);

    if (!hasCaddy) {
      info('');
      error('Cannot continue setup until Caddy is installed. Re-run `lt dev install` afterwards.');
      if (!parameters.options.fromGluegunMenu) process.exit(blocked ? 1 : 0);
      return 'dev install: caddy missing';
    }

    // 3. brew services conflict warning
    const brewConflict = await detectBrewCaddyConflict();
    if (brewConflict) {
      warning('A `brew services caddy` instance is registered.');
      info(`  Stop it (it crash-loops against our Caddyfile): ${colors.cyan('brew services stop caddy')}`);
      info('  `lt dev install` runs its own service — the brew one is no longer needed.');
    }

    // 4. Install our LaunchAgent / systemd unit
    const paths = getServicePaths();
    info('');
    info(`Installing ${plat === 'darwin' ? 'LaunchAgent' : 'systemd-user unit'} at:`);
    info(colors.dim(`  ${paths.unitFile}`));
    const installResult = await installService();
    if (!installResult.ok) {
      error(installResult.message);
      blocked = true;
    } else {
      if (installResult.created) success(installResult.message);
      else info(colors.dim(installResult.message));
    }

    // 5. Wait for admin endpoint
    if (installResult.ok) {
      info(colors.dim('Waiting for Caddy admin endpoint (:2019) ...'));
      const ready = await waitForServiceReady(8_000);
      const status = await getServiceStatus();
      if (ready && status.daemonReachable) {
        success(`Caddy daemon ready${status.pid ? ` (pid ${status.pid})` : ''}.`);
      } else if (status.loaded && !status.daemonReachable) {
        warning('Service is loaded but admin endpoint did not respond within 8s.');
        info(colors.dim(`  Logs: ${paths.logFile} / ${paths.errFile}`));
        blocked = true;
      } else {
        warning('Caddy daemon did not start. See logs:');
        info(colors.dim(`  ${paths.logFile}`));
        info(colors.dim(`  ${paths.errFile}`));
        blocked = true;
      }
    }

    // 6. Validate Caddyfile
    if (installResult.ok) {
      const validation = await validateCaddyfile();
      if (validation.ok) success('Caddyfile validates');
      else warning(`Caddyfile validation: ${validation.stderr.split('\n').slice(0, 2).join(' / ')}`);
    }

    // 7. CA trust
    info('');
    info(colors.bold('Local CA trust'));
    info('  Caddy creates its local CA on first run. To trust it system-wide,');
    info('  run this once (HOME must be preserved so sudo keeps the user-scoped');
    info('  CA, otherwise caddy looks in /var/root and fails):');
    info(`    ${colors.cyan('sudo -E HOME="$HOME" caddy trust')}`);
    info(`  Browsers will then accept ${colors.cyan('https://*.localhost')} without warnings.`);

    info('');
    if (blocked) {
      warning('Setup incomplete. Address the items above and re-run `lt dev install`.');
    } else {
      success('Setup complete. Use `lt dev migrate` in a project, then `lt dev up`.');
    }

    if (!parameters.options.fromGluegunMenu) process.exit(blocked ? 1 : 0);
    return blocked ? 'dev install: incomplete' : 'dev install: ok';
  },
};

/**
 * Quick `brew services list` scan for a registered caddy service.
 * Returns true on macOS if any entry contains "caddy" — error/started
 * alike, both are conflicts. Always returns false on non-darwin or
 * when `brew` is unavailable (no false positives).
 */
async function detectBrewCaddyConflict(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  return new Promise((resolve) => {
    const { spawn } = require('child_process') as typeof import('child_process');
    const child = spawn('brew', ['services', 'list'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (b: Buffer) => (out += String(b)));
    child.on('error', () => resolve(false));
    child.on('close', () => {
      const conflict = /\bcaddy\b/.test(out) && !/^caddy\s+none\b/m.test(out);
      resolve(conflict);
    });
  });
}

module.exports = InstallCommand;
