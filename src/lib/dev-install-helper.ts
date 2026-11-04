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
import {
  caddyAvailable,
  CADDYFILE_STUB,
  type CaddyOwner,
  paths as caddyPaths,
  type CaddyResult,
  detectCaddyOwner,
  ensureCaddyfile,
  foreignCaddyLines,
  reloadCaddy,
  validateCaddyfile,
} from './caddy';
import {
  caddyLaunchMode,
  getServicePaths,
  getServiceStatus,
  installService,
  startCaddyOnDemand,
  waitForServiceReady,
} from './dev-service';

/** Injection points for {@link runInstall}, so the platform branches are testable on any host. */
export interface RunInstallDeps {
  available?: () => Promise<boolean>;
  detectOwner?: () => Promise<CaddyOwner>;
  launchMode?: ReturnType<typeof caddyLaunchMode>;
  reload?: () => Promise<CaddyResult>;
  start?: () => Promise<{ logFile: string; message: string; ok: boolean }>;
  validate?: () => Promise<CaddyResult>;
}

export interface RunInstallResult {
  /** Setup is incomplete — caddy missing, daemon didn't start, etc. */
  blocked: boolean;
  /** caddy is not on PATH. */
  caddyMissing: boolean;
  /** A Caddy that `lt dev` did not start holds :2019; nothing was installed or started. */
  foreign?: boolean;
  /** The service is installed (macOS/Linux) or lt dev's Caddy runs (Windows). */
  ok: boolean;
  /** lt dev cannot start Caddy on this platform (neither a service nor on demand). */
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
  deps: RunInstallDeps = {},
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

  const mode = deps.launchMode ?? caddyLaunchMode();
  if (mode === 'manual') {
    error(`Starting Caddy is not supported on ${process.platform}. macOS, Linux and Windows are covered.`);
    info(`  Workaround: run \`${colors.cyan(`caddy run --config ${caddyPaths.caddyfile}`)}\` manually.`);
    return { blocked: true, caddyMissing: false, ok: false, unsupported: true };
  }

  let blocked = false;

  // 1. caddy on PATH
  const hasCaddy = await (deps.available ?? caddyAvailable)();
  if (hasCaddy) {
    success('caddy is on PATH');
  } else {
    warning('caddy is not installed.');
    info(`  → macOS: ${colors.cyan('brew install caddy')}`);
    info(`  → Linux: ${colors.cyan('https://caddyserver.com/docs/install')}`);
    info(`  → Windows: ${colors.cyan('winget install CaddyServer.Caddy')}`);
    if (mode === 'service') info('  (Do NOT start it via `brew services` — `lt dev install` runs its own service.)');
    blocked = true;
  }

  // 2. Caddyfile stub, only if absent. An existing file is repaired, never replaced: it holds the
  // routes of every registered project.
  const caddyfileChanged = ensureCaddyfile(CADDYFILE_STUB);
  success(`Caddyfile present at ${caddyPaths.caddyfile}`);

  if (!hasCaddy) {
    info('');
    error('Cannot continue setup until Caddy is installed. Re-run `lt dev install` afterwards.');
    return { blocked: true, caddyMissing: true, ok: false, unsupported: false };
  }

  // 3. Whose Caddy holds :2019? A foreign one is left alone, and our service is not installed
  // either: it would crash-loop against the occupied port.
  const owner = await (deps.detectOwner ?? (() => detectCaddyOwner()))();
  if (owner === 'foreign') {
    info('');
    const [first, ...rest] = foreignCaddyLines();
    error(first);
    rest.forEach((line) => info(`  ${line}`));
    return { blocked: true, caddyMissing: false, foreign: true, ok: false, unsupported: false };
  }
  if (owner === 'ours' && caddyfileChanged) {
    // Our running Caddy serves the repaired file, the owner marker included, from now on.
    const reload = await (deps.reload ?? reloadCaddy)();
    if (!reload.ok) warning(`caddy reload failed: ${reload.stderr.split('\n')[0]}`);
  }

  if (mode === 'on-demand') {
    return installOnDemand(toolbox, owner === 'ours', deps);
  }

  // 4. brew services conflict warning
  const brewConflict = await detectBrewCaddyConflict();
  if (brewConflict) {
    warning('A `brew services caddy` instance is registered.');
    info(`  Stop it (it crash-loops against our Caddyfile): ${colors.cyan('brew services stop caddy')}`);
    info('  `lt dev install` runs its own service — the brew one is no longer needed.');
  }

  // 5. Install our LaunchAgent / systemd unit
  const paths = getServicePaths();
  info('');
  info(`Installing ${process.platform === 'darwin' ? 'LaunchAgent' : 'systemd-user unit'} at:`);
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

  // 6. Wait for admin endpoint
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

  // 7. Validate Caddyfile
  if (installResult.ok) {
    const validation = await validateCaddyfile();
    if (validation.ok) success('Caddyfile validates');
    else warning(`Caddyfile validation: ${validation.stderr.split('\n').slice(0, 2).join(' / ')}`);
  }

  // 8. CA trust
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

/**
 * Windows: no service. Start lt dev's Caddy unless it already runs, then point at the CA trust.
 * Start first, trust second: `caddy trust` talks to the running Caddy's admin API.
 */
async function installOnDemand(
  toolbox: ExtendedGluegunToolbox,
  alreadyRunning: boolean,
  deps: RunInstallDeps,
): Promise<RunInstallResult> {
  const {
    print: { colors, error, info, success, warning },
  } = toolbox;

  info('');
  if (alreadyRunning) {
    success("lt dev's Caddy is already running.");
  } else {
    const started = await (deps.start ?? (() => startCaddyOnDemand()))();
    if (!started.ok) {
      error(started.message);
      info(colors.dim(`  Log: ${started.logFile}`));
      return { blocked: true, caddyMissing: false, ok: false, unsupported: false };
    }
    success(started.message);
  }
  info(colors.dim('  No service on Windows: `lt dev up` starts Caddy again after a restart.'));

  const validation = await (deps.validate ?? validateCaddyfile)();
  if (validation.ok) success('Caddyfile validates');
  else warning(`Caddyfile validation: ${validation.stderr.split('\n').slice(0, 2).join(' / ')}`);

  info('');
  info(colors.bold('Local CA trust'));
  info('  Caddy adds its local CA to the Windows certificate store; Windows may ask you to confirm.');
  info(`  If browsers still warn about ${colors.cyan('https://*.localhost')}, run this while Caddy runs:`);
  info(`    ${colors.cyan('caddy trust')}`);
  return { blocked: false, caddyMissing: false, ok: true, unsupported: false };
}
