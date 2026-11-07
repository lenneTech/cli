/**
 * Service lifecycle for the dedicated `lt-dev` Caddy daemon.
 *
 * Why a dedicated service:
 *   `brew services start caddy` is fragile because the Homebrew plist
 *   hardcodes `--config /opt/homebrew/etc/Caddyfile` (or the equivalent
 *   Intel/Linux paths). When lt-dev keeps its Caddyfile at
 *   `~/.lenneTech/Caddyfile`, Caddy crashes in an endless relaunch
 *   loop, port 2019 never opens, and `sudo caddy trust` fails with
 *   "connection refused" — which is what blocked the first real
 *   install attempt. Owning the service definition removes that
 *   coupling entirely.
 *
 * Platforms:
 *   - macOS  (Darwin): per-user LaunchAgent under
 *     `~/Library/LaunchAgents/tech.lenne.lt-dev-caddy.plist`,
 *     bootstrapped via `launchctl bootstrap gui/<uid> <plist>`.
 *   - Linux:  systemd-user unit at
 *     `~/.config/systemd/user/lt-dev-caddy.service`, controlled via
 *     `systemctl --user`.
 *   - Windows, and Linux without systemd (WSL2 by default, containers): no
 *     service. `lt dev install`, `lt dev up`, `lt dev test`
 *     and `lt dev tunnel` start Caddy themselves as a detached background
 *     process when none runs (`startCaddyOnDemand`). A Windows service
 *     would run as another account with its own local CA, which the
 *     user's browser does not trust, and Caddy binds :443 there without
 *     admin rights. See `caddyLaunchMode`.
 *   - Anything else (BSDs without systemd-user): explicitly unsupported —
 *     the caller surfaces a clear message.
 *
 * Tests inject a `ShellRunner` to mock `launchctl` / `systemctl`
 * without touching the real OS. Render functions stay pure.
 */
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir, platform, userInfo } from 'os';
import { dirname, join } from 'path';

import { type CaddyOwner, paths as caddyPaths, detectCaddyOwner, stopOwnCaddy } from './caddy';
import { httpStatus, probePorts, spawnDetached } from './dev-process';
import { findExecutable, type FindExecutableOptions } from './platform';

/**
 * Resolve the user's home directory in a test-overridable way.
 *
 * `os.homedir()` on macOS goes through `getpwuid()` and **ignores**
 * `process.env.HOME`, which makes it impossible to redirect file-system
 * side effects in tests. Honouring `HOME` first (then falling back to
 * `homedir()`) keeps real-world behaviour identical while letting tests
 * scope writes to a temp directory by setting `process.env.HOME` in
 * `beforeEach`.
 */
function userHome(): string {
  return process.env.HOME || homedir();
}

/** Reverse-DNS label of the macOS LaunchAgent. Keep stable — launchctl addresses the agent by it. */
export const SERVICE_LABEL = 'tech.lenne.lt-dev-caddy';

/**
 * Name of the systemd-user unit, without `.service`. systemd addresses a unit by its FILE name,
 * so this is the file name and the name every `systemctl --user` call uses. 1.23.0 to 1.58.0
 * wrote `lt-dev-caddy.service` but called `systemctl` with `tech.lenne.lt-dev-caddy.service`:
 * `lt dev install` failed on every Linux with "Unit file … does not exist".
 */
export const SYSTEMD_UNIT_NAME = 'lt-dev-caddy';

/**
 * The command that stops and disables the system service of Caddy's apt package (see
 * {@link systemCaddyService}).
 */
export const DISABLE_SYSTEM_CADDY = 'sudo systemctl disable --now caddy';

/** Outcome of `installService`. */
export interface InstallServiceResult {
  bootstrapped: boolean;
  created: boolean;
  message: string;
  ok: boolean;
}

/** Inputs needed to render a unit file. */
export interface ServiceConfig {
  caddyBin: string;
  caddyfile: string;
  errFile: string;
  homeDir: string;
  label: string;
  logFile: string;
}

/** File-system paths for the resolved service. */
export interface ServicePaths {
  errFile: string;
  label: string;
  logFile: string;
  platform: 'darwin' | 'linux' | 'unsupported';
  unitFile: string;
}

/** Live service state. */
export interface ServiceStatus {
  daemonReachable: boolean;
  installed: boolean;
  loaded: boolean;
  pid?: number;
  platform: 'darwin' | 'linux' | 'unsupported';
  /** Linux: `systemctl --user is-active` as printed (`active`, `activating` in a restart loop, `failed`, …). */
  state?: string;
  unitFile: string;
}

/** Result of a child-process invocation. */
export interface ShellResult {
  code: null | number;
  ok: boolean;
  stderr: string;
  stdout: string;
}

/** Pluggable shell runner — tests inject this to mock launchctl/systemctl. */
export type ShellRunner = (cmd: string, args: string[]) => Promise<ShellResult>;

/** State of the system service of Caddy's apt package ({@link systemCaddyService}). */
export interface SystemCaddyService {
  active: boolean;
  enabled: boolean;
}

/** Outcome of `uninstallService`. */
export interface UninstallServiceResult {
  bootedOut: boolean;
  message: string;
  ok: boolean;
  removed: string[];
}

let activeRunner: ShellRunner = defaultShellRunner;

/**
 * How Caddy gets started on this platform.
 *
 * - `service`: a LaunchAgent / systemd-user unit owns it (`installService`).
 * - `on-demand`: `lt dev` starts it itself when none runs (`startCaddyOnDemand`): Windows, and a
 *   Linux without systemd. WSL2 runs without systemd unless `/etc/wsl.conf` has `[boot]
 *   systemd=true`, and so do most containers; `systemctl --user` then fails and a service could
 *   never be installed.
 * - `manual`: the user starts it; lt dev only prints the command.
 * @param p - `process.platform`
 * @param systemd - Linux only: whether systemd runs ({@link isSystemdBooted})
 */
export function caddyLaunchMode(
  p: NodeJS.Platform = platform(),
  systemd: boolean = p === 'linux' && isSystemdBooted(),
): 'manual' | 'on-demand' | 'service' {
  if (p === 'darwin') return 'service';
  if (p === 'linux') return systemd ? 'service' : 'on-demand';
  if (p === 'win32') return 'on-demand';
  return 'manual';
}

/**
 * How to restart lt dev's own Caddy by hand, for a hint (see {@link restartOwnCaddy}).
 * @param mode - The launch mode ({@link caddyLaunchMode})
 */
export function caddyRestartCommand(mode: ReturnType<typeof caddyLaunchMode> = caddyLaunchMode()): string {
  return mode === 'service' && platform() === 'linux'
    ? `systemctl --user restart ${SYSTEMD_UNIT_NAME}`
    : 'caddy stop && lt dev up';
}

/** Compute the file-system locations for the service. Pure. */
export function getServicePaths(home: string = userHome(), plat = platformSupported()): ServicePaths {
  const logFile = join(home, '.lenneTech', 'caddy.log');
  const errFile = join(home, '.lenneTech', 'caddy.err.log');
  if (plat === 'darwin') {
    return {
      errFile,
      label: SERVICE_LABEL,
      logFile,
      platform: 'darwin',
      unitFile: join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`),
    };
  }
  if (plat === 'linux') {
    return {
      errFile,
      label: SYSTEMD_UNIT_NAME,
      logFile,
      platform: 'linux',
      unitFile: join(home, '.config', 'systemd', 'user', `${SYSTEMD_UNIT_NAME}.service`),
    };
  }
  return { errFile, label: SERVICE_LABEL, logFile, platform: 'unsupported', unitFile: '' };
}

/** Current service state — installed/loaded/reachable. */
export async function getServiceStatus(
  opts: { platform?: ReturnType<typeof platformSupported> } = {},
): Promise<ServiceStatus> {
  const paths = getServicePaths(userHome(), opts.platform ?? platformSupported());
  const installed = paths.platform !== 'unsupported' && existsSync(paths.unitFile);

  let loaded = false;
  let pid: number | undefined;
  let state: string | undefined;
  if (paths.platform === 'darwin' && installed) {
    const uid = userInfo().uid;
    const res = await activeRunner('launchctl', ['print', `gui/${uid}/${paths.label}`]);
    loaded = res.ok;
    const pidMatch = res.stdout.match(/pid\s*=\s*(\d+)/);
    if (pidMatch) pid = Number(pidMatch[1]);
  } else if (paths.platform === 'linux' && installed) {
    const res = await activeRunner('systemctl', ['--user', 'is-active', `${paths.label}.service`]);
    state = res.stdout.trim() || undefined;
    loaded = res.ok && state === 'active';
    if (loaded) {
      const pidRes = await activeRunner('systemctl', ['--user', 'show', `${paths.label}.service`, '-p', 'MainPID']);
      const m = pidRes.stdout.match(/MainPID=(\d+)/);
      if (m && m[1] !== '0') pid = Number(m[1]);
    }
  }

  const daemonReachable = await pingCaddyAdmin();
  return { daemonReachable, installed, loaded, pid, platform: paths.platform, state, unitFile: paths.unitFile };
}

/**
 * Install (or update) and start the service.
 *
 * Idempotent:
 *   - rewrites the unit file only when its content changes
 *   - bootstraps the service only when not already loaded
 *   - on content change: bootout + bootstrap (= reload)
 */
export async function installService(
  opts: { caddyBin?: string; lookup?: FindExecutableOptions; platform?: ReturnType<typeof platformSupported> } = {},
): Promise<InstallServiceResult> {
  const plat = opts.platform ?? platformSupported();
  if (plat === 'unsupported') {
    return {
      bootstrapped: false,
      created: false,
      message: 'Service management is only supported on macOS and Linux.',
      ok: false,
    };
  }

  const caddyBin = opts.caddyBin || (await resolveCaddyBin(opts.lookup));
  if (!caddyBin) {
    return {
      bootstrapped: false,
      created: false,
      message: caddyMissingMessage(),
      ok: false,
    };
  }

  const paths = getServicePaths(userHome(), plat);
  const cfg: ServiceConfig = {
    caddyBin,
    caddyfile: caddyPaths.caddyfile,
    errFile: paths.errFile,
    homeDir: userHome(),
    label: paths.label,
    logFile: paths.logFile,
  };

  const desired = plat === 'darwin' ? renderLaunchAgentPlist(cfg) : renderSystemdUnit(cfg);
  const existed = existsSync(paths.unitFile);
  const current = existed ? readFileSync(paths.unitFile, 'utf8') : '';
  const changed = current !== desired;

  if (changed) {
    mkdirSync(dirname(paths.unitFile), { recursive: true });
    // Make sure log targets exist + are writable BEFORE the daemon
    // tries to open them — otherwise launchd silently keeps restarting.
    mkdirSync(dirname(paths.logFile), { recursive: true });
    touchFile(paths.logFile);
    touchFile(paths.errFile);
    writeFileSync(paths.unitFile, desired, 'utf8');
  }

  if (plat === 'darwin') return installDarwin(paths, changed, existed);
  return installLinux(paths, changed, existed);
}

/**
 * Whether systemd is the running init system: the check of `sd_booted()`, which `systemctl` itself
 * relies on (`/run/systemd/system` exists only while systemd runs as PID 1).
 * @param exists - File probe (tests)
 */
export function isSystemdBooted(exists: (path: string) => boolean = existsSync): boolean {
  return exists('/run/systemd/system');
}

/** Detect the supported platform. */
export function platformSupported(): 'darwin' | 'linux' | 'unsupported' {
  const p = platform();
  if (p === 'darwin') return 'darwin';
  if (p === 'linux') return 'linux';
  return 'unsupported';
}

/**
 * Render the macOS LaunchAgent plist.
 *
 * Critical env keys:
 *   - HOME:  caddy stores its local CA in `$HOME/Library/Application
 *            Support/Caddy/` — without HOME caddy falls back to
 *            launchd's empty default and fails to persist CA state.
 *   - PATH:  caddy shells out to `security` (Keychain) during
 *            `caddy trust`; a minimal launchd PATH cannot find it.
 */
export function renderLaunchAgentPlist(cfg: ServiceConfig): string {
  const programArgs = [cfg.caddyBin, 'run', '--config', cfg.caddyfile, '--adapter', 'caddyfile'];
  const programArgsXml = programArgs.map((a) => `        <string>${escapeXml(a)}</string>`).join('\n');
  const pathValue = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(cfg.label)}</string>
    <key>ProgramArguments</key>
    <array>
${programArgsXml}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${escapeXml(cfg.homeDir)}</string>
        <key>PATH</key>
        <string>${pathValue}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${escapeXml(cfg.homeDir)}</string>
    <key>StandardOutPath</key>
    <string>${escapeXml(cfg.logFile)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(cfg.errFile)}</string>
</dict>
</plist>
`;
}

/** Render the systemd-user unit file. */
export function renderSystemdUnit(cfg: ServiceConfig): string {
  return `[Unit]
Description=lt-dev Caddy reverse proxy (HTTPS for *.localhost)
Documentation=https://github.com/lenneTech/cli
After=network.target

[Service]
Type=simple
Environment=HOME=${cfg.homeDir}
ExecStart=${cfg.caddyBin} run --config ${cfg.caddyfile} --adapter caddyfile
Restart=on-failure
RestartSec=5s
StandardOutput=append:${cfg.logFile}
StandardError=append:${cfg.errFile}

[Install]
WantedBy=default.target
`;
}

/**
 * Absolute path of `caddy`, so launchd/systemd get a guaranteed path rather than
 * a PATH lookup in an environment they do not share with the user's shell.
 *
 * Resolved in-process instead of by spawning `which`: there is no `which` on
 * Windows, and `where.exe` prints every match rather than the first. The async
 * signature is kept because callers await it and a future platform may need to
 * ask something that does spawn.
 */
export async function resolveCaddyBin(options: FindExecutableOptions = {}): Promise<string | undefined> {
  return findExecutable('caddy', options) ?? undefined;
}

/**
 * Restart lt dev's own Caddy, so it gets a file capability set after it started: Linux hands a
 * process its binary's capabilities when it starts, never later, so the running Caddy keeps
 * failing every reload with `bind: permission denied` until it is restarted.
 *
 * - service running: `systemctl --user restart` (systemd starts it again at once)
 * - otherwise (on demand, or started by hand): `caddy stop`; the next `lt dev install` /
 *   `lt dev up` starts it again from lt dev's Caddyfile
 * A foreign Caddy, or none, is left alone.
 * @param deps - Injection points (tests)
 */
export async function restartOwnCaddy(
  deps: {
    detectOwner?: () => Promise<CaddyOwner>;
    platform?: NodeJS.Platform;
    stop?: () => Promise<{ result?: { ok: boolean } }>;
  } = {},
): Promise<'failed' | 'none' | 'restarted' | 'stopped'> {
  const owner = await (deps.detectOwner ?? (() => detectCaddyOwner()))();
  if (owner !== 'ours') return 'none';
  if ((deps.platform ?? platform()) === 'linux') {
    const unit = `${SYSTEMD_UNIT_NAME}.service`;
    const active = await activeRunner('systemctl', ['--user', 'is-active', unit]);
    if (active.ok && active.stdout.trim() === 'active') {
      return (await activeRunner('systemctl', ['--user', 'restart', unit])).ok ? 'restarted' : 'failed';
    }
  }
  const stopped = await (deps.stop ?? (() => stopOwnCaddy({ detectOwner: async () => owner })))();
  return stopped.result?.ok ? 'stopped' : 'failed';
}

/**
 * The pid of the Caddy on the admin port: its listener (`probePorts`), else the MainPID of lt
 * dev's service. A Caddy started from a file with a capability is non-dumpable, so its sockets
 * are invisible to lsof / ss of the same user; the service's MainPID still names it.
 * @param deps - Injection points (tests)
 */
export async function runningCaddyPid(
  deps: { probe?: typeof probePorts; status?: () => Promise<ServiceStatus> } = {},
): Promise<number | undefined> {
  const port = Number(caddyPaths.admin.split(':').pop());
  const listener = (await (deps.probe ?? probePorts)([port])).owners.get(port)?.pid;
  if (listener) return listener;
  return (await (deps.status ?? getServiceStatus)()).pid;
}

/** Inject a custom runner (tests). Pass `null` to reset to the real spawner. */
export function setShellRunner(runner: null | ShellRunner): void {
  activeRunner = runner ?? defaultShellRunner;
}

/**
 * Start lt dev's Caddy as a detached background process, then wait for its admin API.
 *
 * Only for `caddyLaunchMode() === 'on-demand'`, and only when nothing answers on :2019: this
 * starts a Caddy, it never replaces one. `caddy run` under our own detached spawn rather than
 * `caddy start`: `caddy start` hands its own stdout/stderr to the background child, so a caller
 * that captures them leaves the child writing into a pipe that closes when the CLI exits.
 * `spawnDetached` sends both to `~/.lenneTech/caddy.log` instead.
 * @param deps - Injection points (tests)
 */
export async function startCaddyOnDemand(
  deps: {
    resolveBin?: () => Promise<string | undefined>;
    spawn?: typeof spawnDetached;
    waitReady?: (timeoutMs: number) => Promise<boolean>;
  } = {},
): Promise<{ logFile: string; message: string; ok: boolean }> {
  const logFile = getServicePaths().logFile;
  const bin = await (deps.resolveBin ?? (() => resolveCaddyBin()))();
  if (!bin) {
    return { logFile, message: caddyMissingMessage(), ok: false };
  }
  const spawned = (deps.spawn ?? spawnDetached)(
    bin,
    ['run', '--config', caddyPaths.caddyfile, '--adapter', 'caddyfile'],
    { cwd: userHome(), env: process.env, logFile },
  );
  if (!spawned) {
    return { logFile, message: `Could not start ${bin}.`, ok: false };
  }
  if (!(await (deps.waitReady ?? waitForServiceReady)(8_000))) {
    return { logFile, message: 'Caddy was started, but its admin API (:2019) did not answer within 8s.', ok: false };
  }
  return { logFile, message: `Started Caddy (pid ${spawned.pid}).`, ok: true };
}

/**
 * What to say about the system service of Caddy's apt package, or nothing.
 * @param state - From {@link systemCaddyService}
 */
export function systemCaddyLines(state: null | SystemCaddyService): string[] {
  if (!state) return [];
  return [
    state.active
      ? "It is the system service of Caddy's apt package (caddy.service), which takes ports 2019 and 80 next to lt dev's own Caddy."
      : "Caddy's apt package enabled its system service (caddy.service): after the next restart it takes ports 2019 and 80 before lt dev's own Caddy does.",
    `lt dev runs its own Caddy as your user and needs no other one. Stop and disable it: ${DISABLE_SYSTEM_CADDY}`,
  ];
}

/**
 * The system service Caddy's apt package installs (`caddy.service`), when it is enabled or
 * running. It starts at boot as root on :2019 and :80, before lt dev's user service, which then
 * fails with "address already in use" in a restart loop, and `lt dev` can only report a foreign
 * Caddy. Read-only: `systemctl is-enabled` / `is-active` need no root.
 * @param deps - Injection points (tests)
 * @returns null when there is no such service, it is neither enabled nor running, or this is no
 *   Linux with systemd
 */
export async function systemCaddyService(
  deps: { platform?: NodeJS.Platform; systemd?: boolean } = {},
): Promise<null | SystemCaddyService> {
  if ((deps.platform ?? platform()) !== 'linux' || !(deps.systemd ?? isSystemdBooted())) return null;
  const enabled = (await activeRunner('systemctl', ['is-enabled', 'caddy.service'])).stdout.trim();
  const active = (await activeRunner('systemctl', ['is-active', 'caddy.service'])).stdout.trim();
  const state = {
    active: active === 'active' || active === 'activating',
    enabled: enabled === 'enabled' || enabled === 'enabled-runtime',
  };
  return state.active || state.enabled ? state : null;
}

/** Stop the service and remove the unit file. */
export async function uninstallService(
  opts: { platform?: ReturnType<typeof platformSupported> } = {},
): Promise<UninstallServiceResult> {
  const plat = opts.platform ?? platformSupported();
  if (plat === 'unsupported') {
    return { bootedOut: false, message: 'Nothing to uninstall on this platform.', ok: true, removed: [] };
  }
  const paths = getServicePaths(userHome(), plat);

  let bootedOut = false;
  if (plat === 'darwin') {
    const uid = userInfo().uid;
    const target = `gui/${uid}/${paths.label}`;
    const printRes = await activeRunner('launchctl', ['print', target]);
    if (printRes.ok) {
      const result = await activeRunner('launchctl', ['bootout', target]);
      bootedOut = result.ok;
      // bootout returns non-zero with "Operation now in progress" on some
      // macOS versions even when the service is unloaded — tolerate it.
      if (!result.ok && /no such process|not loaded|service is not loaded/i.test(result.stderr)) bootedOut = true;
    }
  } else {
    await activeRunner('systemctl', ['--user', 'stop', `${paths.label}.service`]);
    const dis = await activeRunner('systemctl', ['--user', 'disable', `${paths.label}.service`]);
    bootedOut = dis.ok;
  }

  const removed: string[] = [];
  if (existsSync(paths.unitFile)) {
    unlinkSync(paths.unitFile);
    removed.push(paths.unitFile);
  }

  return {
    bootedOut,
    message:
      removed.length > 0 ? `Service uninstalled (${removed.length} file(s) removed).` : 'Service was not installed.',
    ok: true,
    removed,
  };
}

/** Wait until Caddy's admin API responds, or until timeout. Returns true on success. */
export async function waitForServiceReady(timeoutMs = 5_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pingCaddyAdmin()) return true;
    await sleep(150);
  }
  return false;
}

/** Install hint for the current platform — `brew` is not advice on Linux or Windows. */
function caddyMissingMessage(): string {
  if (process.platform === 'darwin') {
    return 'caddy not found on PATH. Install with `brew install caddy`.';
  }
  if (process.platform === 'win32') {
    return 'caddy not found on PATH. Install with `winget install CaddyServer.Caddy` or `scoop install caddy`.';
  }
  return 'caddy not found on PATH. Install it with your package manager.';
}

function defaultShellRunner(cmd: string, args: string[]): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let errored = false;
    child.stdout?.on('data', (b) => (stdout += String(b)));
    child.stderr?.on('data', (b) => (stderr += String(b)));
    child.on('error', () => (errored = true));
    child.on('close', (code) => {
      if (errored) resolve({ code: null, ok: false, stderr: stderr || 'command not found', stdout });
      else resolve({ code, ok: code === 0, stderr, stdout });
    });
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function installDarwin(paths: ServicePaths, changed: boolean, existed: boolean): Promise<InstallServiceResult> {
  const uid = userInfo().uid;
  const target = `gui/${uid}/${paths.label}`;

  const print = await activeRunner('launchctl', ['print', target]);
  const alreadyLoaded = print.ok;

  if (alreadyLoaded && changed) {
    // bootout returns "no such process" with a non-zero exit on macOS 14+
    // even on success; we re-check via `print` to confirm.
    await activeRunner('launchctl', ['bootout', target]);
  }

  let bootstrapped = alreadyLoaded && !changed;
  if (!bootstrapped) {
    const result = await activeRunner('launchctl', ['bootstrap', `gui/${uid}`, paths.unitFile]);
    bootstrapped = result.ok;
    if (!bootstrapped) {
      return {
        bootstrapped: false,
        created: changed,
        message: `launchctl bootstrap failed: ${result.stderr.trim() || result.stdout.trim() || 'unknown error'}`,
        ok: false,
      };
    }
  }

  return {
    bootstrapped,
    created: changed,
    message: existed && !changed ? 'Service already installed and up to date.' : 'Service installed.',
    ok: true,
  };
}

async function installLinux(paths: ServicePaths, changed: boolean, existed: boolean): Promise<InstallServiceResult> {
  const reload = await activeRunner('systemctl', ['--user', 'daemon-reload']);
  if (!reload.ok) {
    return {
      bootstrapped: false,
      created: changed,
      message: `systemctl daemon-reload failed: ${reload.stderr.trim() || 'unknown error'}`,
      ok: false,
    };
  }
  const enableRes = await activeRunner('systemctl', ['--user', 'enable', '--now', `${paths.label}.service`]);
  if (!enableRes.ok) {
    return {
      bootstrapped: false,
      created: changed,
      message: `systemctl --user enable --now failed: ${enableRes.stderr.trim() || 'unknown error'}`,
      ok: false,
    };
  }
  // `enable --now` leaves a RUNNING unit alone, so a changed unit (another caddy binary, a new
  // Caddyfile path) would only apply after the next login. Restart it so it applies now.
  if (existed && changed) {
    const restartRes = await activeRunner('systemctl', ['--user', 'restart', `${paths.label}.service`]);
    if (!restartRes.ok) {
      return {
        bootstrapped: true,
        created: changed,
        message: `systemctl --user restart failed: ${restartRes.stderr.trim() || 'unknown error'}`,
        ok: false,
      };
    }
  }
  return {
    bootstrapped: true,
    created: changed,
    message: existed && !changed ? 'Service already installed and up to date.' : 'Service installed.',
    ok: true,
  };
}

/** See `caddy.ts#caddyDaemonRunning` for why this is not a `curl` any more. */
async function pingCaddyAdmin(): Promise<boolean> {
  return (await httpStatus(`http://${caddyPaths.admin}/config/`, 1000)) !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function touchFile(p: string): void {
  if (!existsSync(p)) writeFileSync(p, '', 'utf8');
}
