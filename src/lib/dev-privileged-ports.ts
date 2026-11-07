/**
 * Can lt dev's Caddy bind ports 80 and 443 on Linux?
 *
 * Linux lets an unprivileged process bind a port below `net.ipv4.ip_unprivileged_port_start`
 * (default 1024) only with the `cap_net_bind_service` file capability. lt dev runs Caddy as the
 * user (systemd user unit or on demand), so without it every `lt dev up` fails on the reload with
 * `bind: permission denied`. No common install sets it on the file: Caddy's Debian/Ubuntu package
 * grants it only to its own system service (`AmbientCapabilities` in `caddy.service`, measured
 * with Caddy 2.11.9: `getcap /usr/bin/caddy` is empty), and a binary from GitHub, `go install` or
 * Homebrew on Linux has none either. Replacing the binary (an update) drops a capability set by
 * hand. A RUNNING Caddy keeps the capabilities it started with, so after `setcap` it has to be
 * restarted ({@link processMayBindPrivilegedPorts}). macOS and Windows need none of this.
 */
import { readFileSync, realpathSync } from 'fs';
import { userInfo } from 'os';

import { execArgs } from './exec-args';

/** Injection points for {@link privilegedPortProblem}. */
export interface PrivilegedPortDeps {
  platform?: NodeJS.Platform;
  readFile?: (path: string) => string;
  realpath?: (path: string) => string;
  /** Runs `getcap`; rejects like `execArgs` (an `ENOENT` code when the program is missing). */
  run?: (command: string, args: readonly string[]) => Promise<string>;
  uid?: number;
}

/** Why Caddy cannot bind 80/443, and the commands that fix it. */
export interface PrivilegedPortProblem {
  /** Shell commands to run once, in order. */
  commands: string[];
  /** The resolved caddy binary the capability belongs to. */
  realBin: string;
  reason: string;
}

/**
 * What lets lt dev's Caddy bind ports 80 and 443 here, if anything:
 * - `not-linux`: macOS and Windows need nothing
 * - `root` / `sysctl`: allowed without a capability (`ip_unprivileged_port_start` <= 80, the
 *   default inside Docker containers); a running Caddy then never holds the capability bit
 * - `capability`: the FILE capability, which only processes started after `setcap` have
 * - `none`: nothing; `unknown`: `getcap` is not installed
 * @param caddyBin - The caddy on PATH (a symlink is resolved: capabilities sit on the real file)
 * @param deps - Injection points (tests)
 */
export async function privilegedPortGrant(
  caddyBin: string,
  deps: PrivilegedPortDeps = {},
): Promise<{ grant: 'capability' | 'none' | 'not-linux' | 'root' | 'sysctl' | 'unknown'; realBin: string }> {
  if ((deps.platform ?? process.platform) !== 'linux') return { grant: 'not-linux', realBin: caddyBin };
  if ((deps.uid ?? userInfo().uid) === 0) return { grant: 'root', realBin: caddyBin };
  const read = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  try {
    const start = Number.parseInt(read('/proc/sys/net/ipv4/ip_unprivileged_port_start').trim(), 10);
    if (Number.isFinite(start) && start <= 80) return { grant: 'sysctl', realBin: caddyBin };
  } catch {
    // No such sysctl (very old kernel): the 1024 default applies.
  }

  let realBin = caddyBin;
  try {
    realBin = (deps.realpath ?? realpathSync)(caddyBin);
  } catch {
    // Keep the PATH entry; setcap on it reports its own error.
  }
  try {
    const out = await (deps.run ?? ((command, args) => execArgs(command, args)))('getcap', [realBin]);
    if (out.includes('cap_net_bind_service')) return { grant: 'capability', realBin };
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return { grant: 'unknown', realBin };
    // getcap ran and failed (file unreadable): setcap is the fix either way.
  }
  return { grant: 'none', realBin };
}

/**
 * Whether lt dev's Caddy would be refused ports 80/443, and how to allow them.
 * @param caddyBin - The caddy on PATH (a symlink is resolved: capabilities sit on the real file)
 * @param deps - Injection points (tests)
 * @returns null when binding works (or this is not Linux)
 */
export async function privilegedPortProblem(
  caddyBin: string,
  deps: PrivilegedPortDeps = {},
): Promise<null | PrivilegedPortProblem> {
  const { grant, realBin } = await privilegedPortGrant(caddyBin, deps);
  if (grant !== 'none' && grant !== 'unknown') return null;
  const setcap = `sudo setcap cap_net_bind_service=+ep ${shellQuote(realBin)}`;
  if (grant === 'unknown') {
    return {
      commands: ['sudo apt install libcap2-bin   # Debian/Ubuntu; provides getcap and setcap', setcap],
      realBin,
      reason: 'getcap is not installed, so lt dev cannot tell whether caddy may bind ports 80 and 443',
    };
  }
  return {
    commands: [setcap],
    realBin,
    reason: `${realBin} may not bind ports 80 and 443 as your user (Linux allows ports below 1024 only with cap_net_bind_service)`,
  };
}

/**
 * Whether a running process holds `CAP_NET_BIND_SERVICE` (bit 10 of `CapEff` in
 * `/proc/<pid>/status`). A Caddy started before `setcap` lacks it although its file has it.
 * @param pid - The process
 * @param read - File reader (tests)
 * @returns null when the status cannot be read (no such process, not Linux)
 */
export function processMayBindPrivilegedPorts(
  pid: number,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): boolean | null {
  let status: string;
  try {
    status = read(`/proc/${pid}/status`);
  } catch {
    return null;
  }
  const hex = status.match(/^CapEff:\s*([0-9a-fA-F]+)\s*$/m)?.[1];
  if (!hex) return null;
  // Bit 10 lies in the lowest 32 bits; parsing only those avoids BigInt (target es6).
  return (Number.parseInt(hex.slice(-8), 16) & (1 << 10)) !== 0;
}

/**
 * Whether lt dev's RUNNING Caddy was started before its binary got the capability, i.e. a restart
 * would let it bind 80/443. Only judged when the FILE capability is what grants the ports: a
 * process that may bind through the sysctl or as root never holds the bit, and a restart would
 * change nothing there.
 * @param caddyBin - The caddy on PATH
 * @param pid - The running Caddy (the listener on the admin port, or the service's MainPID)
 * @param deps - Injection points (tests); `readFile` also reads `/proc/<pid>/status`
 */
export async function runningCaddyMissesCapability(
  caddyBin: string,
  pid: number | undefined,
  deps: PrivilegedPortDeps = {},
): Promise<boolean> {
  if (!pid) return false;
  if ((await privilegedPortGrant(caddyBin, deps)).grant !== 'capability') return false;
  return processMayBindPrivilegedPorts(pid, deps.readFile) === false;
}

/** Quotes a path for a POSIX shell command line shown to the user. */
function shellQuote(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
