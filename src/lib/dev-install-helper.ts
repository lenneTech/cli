/**
 * Reusable per-machine setup logic for `lt dev`.
 *
 * Used by `commands/dev/install.ts` (the explicit command) and by
 * `commands/dev/init.ts` (auto-chained when the machine isn't prepared
 * yet). Kept as a helper — NOT a cross-command call — so the
 * install↔init auto-chaining can never recurse (see `dev-bootstrap.ts`).
 *
 * Prints progress via the toolbox but NEVER calls `process.exit`; the
 * caller decides the exit code from the returned result.
 */
import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { caddyAvailable, paths as caddyPaths, validateCaddyfile, writeCaddyfile } from './caddy';
import {
  getServicePaths,
  getServiceStatus,
  installService,
  platformSupported,
  waitForServiceReady,
} from './dev-service';

export interface RunInstallResult {
  /** Setup is incomplete — caddy missing, daemon didn't start, etc. */
  blocked: boolean;
  /** caddy is not on PATH. */
  caddyMissing: boolean;
  /** installService succeeded (unit written + bootstrapped). */
  ok: boolean;
  /** Platform has no supported service model (not macOS/Linux). */
  unsupported: boolean;
}

/**
 * Run the one-time per-machine `lt dev` setup. Idempotent — safe to
 * re-run. When `opts.auto` is set the heading reflects that it was
 * triggered by another command (e.g. `lt dev init`).
 */
export async function runInstall(
  toolbox: ExtendedGluegunToolbox,
  opts: { auto?: boolean } = {},
): Promise<RunInstallResult> {
  const {
    print: { colors, error, info, success, warning },
  } = toolbox;

  info('');
  info(
    colors.bold(
      opts.auto ? 'Preparing this machine for lt dev (lt dev install)' : 'lt dev install — one-time per-machine setup',
    ),
  );
  info(colors.dim('─'.repeat(60)));

  const plat = platformSupported();
  if (plat === 'unsupported') {
    error(`Service management is not supported on ${process.platform}. Only macOS and Linux are covered.`);
    info(`  Workaround: run \`${colors.cyan(`caddy run --config ${caddyPaths.caddyfile}`)}\` manually.`);
    return { blocked: true, caddyMissing: false, ok: false, unsupported: true };
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
    return { blocked: true, caddyMissing: true, ok: false, unsupported: false };
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
  } else if (installResult.created) {
    success(installResult.message);
  } else {
    info(colors.dim(installResult.message));
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

  return { blocked, caddyMissing: false, ok: installResult.ok, unsupported: false };
}

/**
 * Quick `brew services list` scan for a registered caddy service.
 * Returns true on macOS if any entry contains "caddy" — error/started
 * alike, both are conflicts. Always returns false on non-darwin or
 * when `brew` is unavailable (no false positives).
 */
function detectBrewCaddyConflict(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false);
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
