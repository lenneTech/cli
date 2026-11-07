/**
 * WSL (Windows Subsystem for Linux) detection, and the one address a Windows browser reaches
 * lt dev's Caddy from.
 *
 * `lt dev up` is the way to run a project in WSL2 too. Two things differ from native Linux:
 * the browser runs on Windows (so its root CA has to be in the Windows store, `dev-wsl-ca.ts`),
 * and WSL2's default NAT networking forwards a Windows `localhost` connection into the VM, where it
 * may arrive from the Windows host's address on the virtual switch instead of 127.0.0.1. Every lt
 * site block aborts connections that are not loopback (`caddy.ts`, LAN protection), so that one
 * address has to be allowed as well. It is the VM's default gateway; in mirrored networking
 * Windows shares the loopback and nothing extra is allowed.
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { isIP } from 'net';

/**
 * The default gateway in `/proc/net/route` (hex, little-endian): in WSL2's NAT mode the Windows host.
 * @param table - Content of `/proc/net/route`
 * @returns The IPv4 address, or null when there is no default route
 */
export function defaultGatewayFromRouteTable(table: string): null | string {
  for (const line of table.split('\n').slice(1)) {
    const [, destination, gateway] = line.trim().split(/\s+/);
    if (destination !== '00000000' || !gateway || !/^[0-9A-Fa-f]{8}$/.test(gateway) || gateway === '00000000') continue;
    const bytes = gateway.match(/../g)!.map((pair) => Number.parseInt(pair, 16));
    return bytes.reverse().join('.');
  }
  return null;
}

/**
 * Whether this process runs inside WSL (1 or 2).
 * @param read - Reads a file as text (tests)
 * @param platform - `process.platform` (tests)
 * @returns true when the kernel identifies itself as Microsoft's
 */
export function isWsl(
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'linux') return false;
  // WSL2 kernels report e.g. `6.6.87.2-microsoft-standard-WSL2`, WSL1 `4.4.0-19041-Microsoft`.
  for (const file of ['/proc/sys/kernel/osrelease', '/proc/version']) {
    try {
      if (/microsoft/i.test(read(file))) return true;
    } catch {
      // Not readable: not a decision either way, try the next file.
    }
  }
  return false;
}

let forwarderCache: undefined | { value: null | string };

/**
 * The Windows host address WSL2 forwards browser connections from, or null. Computed once per
 * process.
 *
 * Fails CLOSED: only when `wslinfo` positively reports NAT networking, and never inside a
 * container. A Docker container on a WSL2 kernel also reads as WSL, has no `wslinfo`, and its
 * default gateway is the Docker bridge, which Docker Desktop forwards PUBLISHED ports from: allowing
 * it would let the LAN past the guard of a devcontainer that publishes 443. In mirrored networking
 * the gateway is the LAN router, so nothing is allowed either.
 *
 * `LT_DEV_WSL_HOST_ADDRESS` overrides the detection: an IP address to allow, or `none`. The test
 * setup sets `none`, so no suite depends on the host it runs on; on a WSL whose detection is wrong
 * it is the escape hatch.
 * @param deps - Injection points (tests); passing any of them bypasses the cache and the override
 */
export function wslWindowsHostAddress(
  deps: {
    container?: boolean;
    networkingMode?: () => null | string;
    read?: (path: string) => string;
    wsl?: boolean;
  } = {},
): null | string {
  const injected = Object.keys(deps).length > 0;
  const override = process.env.LT_DEV_WSL_HOST_ADDRESS?.trim();
  // Only a plain IPv4/IPv6 address: anything else would either break the Caddyfile or widen the guard.
  if (!injected && override) return isIP(override) === 0 ? null : override;
  if (!injected && forwarderCache) return forwarderCache.value;
  const read = deps.read ?? ((path: string) => readFileSync(path, 'utf8'));
  let value: null | string = null;
  if ((deps.wsl ?? isWsl(read)) && !(deps.container ?? inContainer())) {
    const mode = (deps.networkingMode ?? wslNetworkingMode)();
    if (mode === 'nat') {
      try {
        value = defaultGatewayFromRouteTable(read('/proc/net/route'));
      } catch {
        value = null;
      }
    }
  }
  if (!injected) forwarderCache = { value };
  return value;
}

/** Docker (`/.dockerenv`) or Podman (`/run/.containerenv`). */
function inContainer(): boolean {
  return existsSync('/.dockerenv') || existsSync('/run/.containerenv');
}

/** `wslinfo --networking-mode` (`nat` or `mirrored`), or null on a WSL without `wslinfo`. */
function wslNetworkingMode(): null | string {
  const result = spawnSync('wslinfo', ['--networking-mode'], { encoding: 'utf8', timeout: 2000 });
  return result.status === 0 ? String(result.stdout).trim().toLowerCase() : null;
}
