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
 *   - Windows: no service at all. `lt dev install` / `lt dev up` start
 *     Caddy on demand as a detached background process
 *     (`startCaddyOnDemand`). Decision D1: a Windows service would run as
 *     SYSTEM with its own CA while the user's browser trusts the user's
 *     CA; Caddy binds :443 there without admin rights, so nothing needs a
 *     service. See `caddyLaunchMode`.
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

import { paths as caddyPaths } from './caddy';
import { httpStatus, spawnDetached } from './dev-process';
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

/** Reverse-DNS label for the service. Keep stable — used in launchctl + systemd. */
export const SERVICE_LABEL = 'tech.lenne.lt-dev-caddy';

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
 * - `on-demand`: `lt dev` starts it itself when nothing runs (`startCaddyOnDemand`).
 * - `manual`: the user starts it; we only print the command.
 */
export function caddyLaunchMode(p: NodeJS.Platform = platform()): 'manual' | 'on-demand' | 'service' {
  if (p === 'darwin' || p === 'linux') return 'service';
  if (p === 'win32') return 'on-demand';
  return 'manual';
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
      label: SERVICE_LABEL,
      logFile,
      platform: 'linux',
      unitFile: join(home, '.config', 'systemd', 'user', 'lt-dev-caddy.service'),
    };
  }
  return { errFile, label: SERVICE_LABEL, logFile, platform: 'unsupported', unitFile: '' };
}

/** Current service state — installed/loaded/reachable. */
export async function getServiceStatus(): Promise<ServiceStatus> {
  const paths = getServicePaths();
  const installed = paths.platform !== 'unsupported' && existsSync(paths.unitFile);

  let loaded = false;
  let pid: number | undefined;
  if (paths.platform === 'darwin' && installed) {
    const uid = userInfo().uid;
    const res = await activeRunner('launchctl', ['print', `gui/${uid}/${paths.label}`]);
    loaded = res.ok;
    const pidMatch = res.stdout.match(/pid\s*=\s*(\d+)/);
    if (pidMatch) pid = Number(pidMatch[1]);
  } else if (paths.platform === 'linux' && installed) {
    const res = await activeRunner('systemctl', ['--user', 'is-active', `${paths.label}.service`]);
    loaded = res.ok && res.stdout.trim() === 'active';
    if (loaded) {
      const pidRes = await activeRunner('systemctl', ['--user', 'show', `${paths.label}.service`, '-p', 'MainPID']);
      const m = pidRes.stdout.match(/MainPID=(\d+)/);
      if (m && m[1] !== '0') pid = Number(m[1]);
    }
  }

  const daemonReachable = await pingCaddyAdmin();
  return { daemonReachable, installed, loaded, pid, platform: paths.platform, unitFile: paths.unitFile };
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
  opts: { caddyBin?: string; lookup?: FindExecutableOptions } = {},
): Promise<InstallServiceResult> {
  const plat = platformSupported();
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

  const paths = getServicePaths();
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

/** Inject a custom runner (tests). Pass `null` to reset to the real spawner. */
export function setShellRunner(runner: null | ShellRunner): void {
  activeRunner = runner ?? defaultShellRunner;
}

/**
 * Start our Caddy as a detached background process, then wait for its admin API.
 *
 * Only for `caddyLaunchMode() === 'on-demand'`, and only after
 * `detectCaddyOwner` answered `none`: this starts a Caddy, it never replaces one.
 *
 * `caddy run` under our own detached spawn rather than `caddy start`: `caddy
 * start` hands its own stdout/stderr to the background child, so a caller that
 * captures them leaves the child writing into a pipe that closes when the CLI
 * exits. `spawnDetached` sends both to `~/.lenneTech/caddy.log` instead.
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
  if (!bin) return { logFile, message: caddyMissingMessage(), ok: false };
  const spawned = (deps.spawn ?? spawnDetached)(
    bin,
    ['run', '--config', caddyPaths.caddyfile, '--adapter', 'caddyfile'],
    { cwd: userHome(), env: process.env, logFile },
  );
  if (!spawned) return { logFile, message: `could not start ${bin}`, ok: false };
  const ready = await (deps.waitReady ?? waitForServiceReady)(8_000);
  return ready
    ? { logFile, message: `Caddy started (pid ${spawned.pid}).`, ok: true }
    : { logFile, message: 'Caddy was started but its admin API (:2019) did not answer within 8s.', ok: false };
}

/** Stop the service and remove the unit file. */
export async function uninstallService(): Promise<UninstallServiceResult> {
  const plat = platformSupported();
  if (plat === 'unsupported') {
    return { bootedOut: false, message: 'Nothing to uninstall on this platform.', ok: true, removed: [] };
  }
  const paths = getServicePaths();

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
  return {
    bootstrapped: true,
    created: changed,
    message: existed && !changed ? 'Service already installed and up to date.' : 'Service installed.',
    ok: true,
  };
}

/** See `caddy.ts#caddyDaemonRunning` for why this is not a `curl` any more. */
async function pingCaddyAdmin(): Promise<boolean> {
  return (await httpStatus('http://127.0.0.1:2019/config/', 1000)) !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function touchFile(p: string): void {
  if (!existsSync(p)) writeFileSync(p, '', 'utf8');
}
