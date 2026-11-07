/**
 * Can lt dev's Caddy bind ports 80 and 443 on Linux?
 *
 * Linux lets an unprivileged process bind a port below `net.ipv4.ip_unprivileged_port_start`
 * (default 1024) only with the `cap_net_bind_service` file capability. lt dev runs Caddy as the
 * user (systemd user unit or on demand), so without it every `lt dev up` fails on the reload with
 * `bind: permission denied`. Caddy's official Debian/Ubuntu package sets the capability on install;
 * a binary from GitHub, `go install` or Homebrew on Linux does not, and replacing the binary (an
 * update) drops it again. macOS and Windows need none of this.
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
 * Whether lt dev's Caddy would be refused ports 80/443, and how to allow them.
 * @param caddyBin - The caddy on PATH (a symlink is resolved: capabilities sit on the real file)
 * @param deps - Injection points (tests)
 * @returns null when binding works (or this is not Linux)
 */
export async function privilegedPortProblem(
  caddyBin: string,
  deps: PrivilegedPortDeps = {},
): Promise<null | PrivilegedPortProblem> {
  if ((deps.platform ?? process.platform) !== 'linux') return null;
  if ((deps.uid ?? userInfo().uid) === 0) return null;
  const read = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  try {
    const start = Number.parseInt(read('/proc/sys/net/ipv4/ip_unprivileged_port_start').trim(), 10);
    if (Number.isFinite(start) && start <= 80) return null;
  } catch {
    // No such sysctl (very old kernel): the 1024 default applies.
  }

  let realBin = caddyBin;
  try {
    realBin = (deps.realpath ?? realpathSync)(caddyBin);
  } catch {
    // Keep the PATH entry; setcap on it reports its own error.
  }
  const setcap = `sudo setcap cap_net_bind_service=+ep ${shellQuote(realBin)}`;
  try {
    const out = await (deps.run ?? ((command, args) => execArgs(command, args)))('getcap', [realBin]);
    if (out.includes('cap_net_bind_service')) return null;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return {
        commands: ['sudo apt install libcap2-bin   # Debian/Ubuntu; provides getcap and setcap', setcap],
        realBin,
        reason: 'getcap is not installed, so lt dev cannot tell whether caddy may bind ports 80 and 443',
      };
    }
    // getcap ran and failed (file unreadable): fall through, setcap is the fix either way.
  }
  return {
    commands: [setcap],
    realBin,
    reason: `${realBin} may not bind ports 80 and 443 as your user (Linux allows ports below 1024 only with cap_net_bind_service)`,
  };
}

/** Quotes a path for a POSIX shell command line shown to the user. */
function shellQuote(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
