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
import { privilegedPortProblem, type PrivilegedPortProblem } from './dev-privileged-ports';
import { runChildInherit } from './dev-process';
import {
  caddyLaunchMode,
  caddyRestartCommand,
  DISABLE_SYSTEM_CADDY,
  getServicePaths,
  getServiceStatus,
  installService,
  resolveCaddyBin,
  restartOwnCaddy,
  startCaddyOnDemand,
  systemCaddyLines,
  type SystemCaddyService,
  systemCaddyService,
  waitForServiceReady,
} from './dev-service';
import { importCaddyRootIntoWindows, type WindowsTrust, windowsTrustsCaddyRoot } from './dev-wsl-ca';
import { isNonInteractive } from './workspace-integration';
import { isWsl } from './wsl';

/** Injection points for {@link runInstall}, so the platform branches are testable on any host. */
export interface RunInstallDeps {
  available?: () => Promise<boolean>;
  /** Ask the user a yes/no question (default: the toolbox prompt). */
  confirm?: (question: string) => Promise<boolean>;
  detectOwner?: () => Promise<CaddyOwner>;
  /** Import the Caddy root into Windows (WSL), or only prepare the command. */
  importWindowsRoot?: typeof importCaddyRootIntoWindows;
  /** Whether prompts may be shown (default: a TTY and no `--noConfirm`). */
  interactive?: boolean;
  launchMode?: ReturnType<typeof caddyLaunchMode>;
  platform?: NodeJS.Platform;
  /** Why Caddy cannot bind 80/443 on Linux, or null. */
  portProblem?: () => Promise<null | PrivilegedPortProblem>;
  reload?: () => Promise<CaddyResult>;
  /** Restart lt dev's own Caddy after `setcap` (`dev-service.ts#restartOwnCaddy`). */
  restartCaddy?: () => Promise<'failed' | 'none' | 'restarted' | 'stopped'>;
  /** Run a command with the terminal attached (`sudo setcap …`); resolves to its exit code. */
  runInteractive?: (command: string, args: string[]) => Promise<null | number>;
  start?: () => Promise<{ logFile: string; message: string; ok: boolean }>;
  /** The system service of Caddy's apt package (`dev-service.ts#systemCaddyService`). */
  systemCaddy?: () => Promise<null | SystemCaddyService>;
  validate?: () => Promise<CaddyResult>;
  /** Whether Windows trusts the Caddy root (WSL). */
  windowsTrust?: () => Promise<WindowsTrust>;
  wsl?: boolean;
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

  // 2b. Linux: may Caddy bind 80/443 as this user? A stub Caddyfile binds neither, so without
  // this check the problem only showed up at the first `lt dev up` (reload: permission denied).
  if (!(await allowPrivilegedPorts(toolbox, deps))) blocked = true;

  // 2c. Linux: the system service of Caddy's apt package takes :2019 and :80 at boot, before our
  // user service, which then restart-loops on "address already in use". Before the owner check,
  // so a Caddy it holds :2019 with is gone once the person agrees to disable it.
  await disableSystemCaddy(toolbox, deps);

  // 3. Whose Caddy holds :2019? A foreign one is left alone, and our service is not installed
  // either: it would crash-loop against the occupied port.
  const owner = await (deps.detectOwner ?? (() => detectCaddyOwner()))();
  if (owner === 'foreign') {
    info('');
    const [first, ...rest] = foreignCaddyLines();
    error(first);
    rest.forEach((line) => info(`  ${line}`));
    systemCaddyLines(await (deps.systemCaddy ?? (() => systemCaddyService()))()).forEach((line) => info(`  ${line}`));
    return { blocked: true, caddyMissing: false, foreign: true, ok: false, unsupported: false };
  }
  if (owner === 'ours' && caddyfileChanged) {
    // Our running Caddy serves the repaired file, the owner marker included, from now on.
    const reload = await (deps.reload ?? reloadCaddy)();
    if (!reload.ok) warning(`caddy reload failed: ${reload.stderr.split('\n')[0]}`);
  }

  if (mode === 'on-demand') {
    const result = await installOnDemand(toolbox, owner === 'ours', deps);
    return blocked ? { ...result, blocked: true } : result;
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
  await printCaTrust(toolbox, deps);

  return { blocked, caddyMissing: false, ok: installResult.ok, unsupported: false };
}

/**
 * Linux: let Caddy bind ports 80 and 443 (`dev-privileged-ports.ts`). Offers to run the fix with
 * sudo when a person sits at the terminal; otherwise prints it.
 * @returns false when Caddy still cannot bind them
 */
async function allowPrivilegedPorts(toolbox: ExtendedGluegunToolbox, deps: RunInstallDeps): Promise<boolean> {
  const {
    print: { colors, info, success, warning },
  } = toolbox;
  const check =
    deps.portProblem ??
    (async () => {
      const bin = await resolveCaddyBin();
      return bin ? privilegedPortProblem(bin) : null;
    });
  const problem = await check();
  if (!problem) return true;
  warning(problem.reason);
  info('  Run once (an update of the caddy binary can undo it):');
  problem.commands.forEach((command) => info(`    ${colors.cyan(command)}`));
  const setcapOnly = problem.commands.length === 1;
  if (!setcapOnly || !(deps.interactive ?? interactiveSession(toolbox))) return false;
  if (!(await (deps.confirm ?? ((q) => toolbox.prompt.confirm(q)))('Run it now with sudo?'))) return false;
  const run =
    deps.runInteractive ??
    ((command, args) => runChildInherit(command, args, { cwd: process.cwd(), env: process.env }));
  await run('sudo', ['setcap', 'cap_net_bind_service=+ep', problem.realBin]);
  if (await check()) return false;
  success('caddy may bind ports 80 and 443');
  // A Caddy that already runs keeps the capabilities it started with, i.e. none: restart it, or
  // every reload keeps failing with `bind: permission denied`.
  const restarted = await (deps.restartCaddy ?? (() => restartOwnCaddy()))();
  if (restarted === 'restarted') success("Restarted lt dev's Caddy, so it uses the capability.");
  else if (restarted === 'failed') {
    warning(`Could not restart lt dev's Caddy. Restart it so it uses the capability: ${caddyRestartCommand()}`);
  }
  return true;
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
 * Linux: report the system service of Caddy's apt package and offer to disable it (see
 * `dev-service.ts#systemCaddyService`). Never blocks the install on its own: an enabled but
 * stopped service only bites after the next restart, a running one shows up as a foreign Caddy.
 */
async function disableSystemCaddy(toolbox: ExtendedGluegunToolbox, deps: RunInstallDeps): Promise<void> {
  const {
    print: { colors, info, success, warning },
  } = toolbox;
  const read = deps.systemCaddy ?? (() => systemCaddyService());
  const state = await read();
  if (!state) return;
  const [first, ...rest] = systemCaddyLines(state);
  warning(first);
  rest.forEach((line) => info(`  ${line}`));
  if (!(deps.interactive ?? interactiveSession(toolbox))) return;
  if (!(await (deps.confirm ?? ((q) => toolbox.prompt.confirm(q)))('Disable it now with sudo?'))) return;
  const run =
    deps.runInteractive ??
    ((command, args) => runChildInherit(command, args, { cwd: process.cwd(), env: process.env }));
  const [command, ...args] = DISABLE_SYSTEM_CADDY.split(' ');
  await run(command, args);
  if (await read()) warning(`caddy.service is still enabled or running. Run: ${colors.cyan(DISABLE_SYSTEM_CADDY)}`);
  else success('Disabled the system service caddy.service');
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
  if ((deps.platform ?? process.platform) === 'win32') {
    info(colors.dim('  No service on Windows: `lt dev up` starts Caddy again after a restart.'));
  } else {
    info(colors.dim('  No systemd here, so no service: `lt dev up` starts Caddy again after a restart.'));
    if (deps.wsl ?? isWsl()) {
      info(colors.dim('  To have it as a service in WSL: add these two lines to /etc/wsl.conf,'));
      info(colors.dim(`    ${colors.cyan('[boot]')}`));
      info(colors.dim(`    ${colors.cyan('systemd=true')}`));
      info(colors.dim(`  run ${colors.cyan('wsl --shutdown')} in Windows, open WSL again and run \`lt dev install\`.`));
    }
  }

  const validation = await (deps.validate ?? validateCaddyfile)();
  if (validation.ok) success('Caddyfile validates');
  else warning(`Caddyfile validation: ${validation.stderr.split('\n').slice(0, 2).join(' / ')}`);

  await printCaTrust(toolbox, deps);
  return { blocked: false, caddyMissing: false, ok: true, unsupported: false };
}

function interactiveSession(toolbox: ExtendedGluegunToolbox): boolean {
  const flag = toolbox.parameters?.options?.noConfirm;
  return !isNonInteractive(flag === true || flag === 'true');
}

/**
 * How the browser comes to trust Caddy's local CA, per platform. In WSL the browser runs on
 * Windows, so the root goes into the Windows store as well (`dev-wsl-ca.ts`).
 */
async function printCaTrust(toolbox: ExtendedGluegunToolbox, deps: RunInstallDeps): Promise<void> {
  const {
    print: { colors, info, success, warning },
  } = toolbox;
  info('');
  info(colors.bold('Local CA trust'));
  if ((deps.platform ?? process.platform) === 'win32') {
    info('  Caddy adds its local CA to the Windows certificate store; Windows may ask you to confirm.');
    info(`  If browsers still warn about ${colors.cyan('https://*.localhost')}, run this while Caddy runs:`);
    info(`    ${colors.cyan('caddy trust')}`);
    return;
  }
  info('  Caddy creates its local CA on first run. To trust it system-wide,');
  info('  run this once (HOME must be preserved so sudo keeps the user-scoped');
  info('  CA, otherwise caddy looks in /var/root and fails):');
  info(`    ${colors.cyan('sudo -E HOME="$HOME" caddy trust')}`);
  if (!(deps.wsl ?? ((deps.platform ?? process.platform) === 'linux' && isWsl()))) {
    info(`  Browsers will then accept ${colors.cyan('https://*.localhost')} without warnings.`);
    return;
  }
  info('  That covers curl and Node inside WSL. The browser runs on Windows and needs the CA there:');
  const trust = await (deps.windowsTrust ?? (() => windowsTrustsCaddyRoot()))();
  if (trust === 'yes') {
    success('Windows trusts the Caddy root CA');
    return;
  }
  const importRoot = deps.importWindowsRoot ?? importCaddyRootIntoWindows;
  const interactive = deps.interactive ?? interactiveSession(toolbox);
  if (
    trust === 'no' &&
    interactive &&
    (await (deps.confirm ?? ((q) => toolbox.prompt.confirm(q)))(
      'Import it into Windows now? (Windows asks you to confirm once)',
    ))
  ) {
    const imported = await importRoot();
    if (imported.ok) {
      success(imported.message);
      return;
    }
    warning(imported.message);
    if (imported.command) info(`    ${colors.cyan(imported.command)}`);
    return;
  }
  const prepared = await importRoot({}, { prepareOnly: true });
  if (trust === 'unknown')
    warning('Windows could not be asked whether it trusts the Caddy root (Windows interop off?).');
  if (prepared.command) {
    info('  Run this in WSL (Windows asks you to confirm once):');
    info(`    ${colors.cyan(prepared.command)}`);
  } else {
    warning(prepared.message);
  }
}
