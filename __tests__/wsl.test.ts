import { defaultGatewayFromRouteTable, isWsl, wslWindowsHostAddress } from '../src/lib/wsl';

describe('isWsl', () => {
  const files = (map: Record<string, string>) => (path: string) => {
    if (!(path in map)) throw new Error(`ENOENT: ${path}`);
    return map[path];
  };

  test('recognises a WSL2 and a WSL1 kernel', () => {
    expect(isWsl(files({ '/proc/sys/kernel/osrelease': '6.6.87.2-microsoft-standard-WSL2\n' }), 'linux')).toBe(true);
    expect(isWsl(files({ '/proc/sys/kernel/osrelease': '4.4.0-19041-Microsoft\n' }), 'linux')).toBe(true);
  });

  test('falls back to /proc/version when osrelease is unreadable', () => {
    expect(
      isWsl(files({ '/proc/version': 'Linux version 5.15.153.1-microsoft-standard-WSL2 (root@1a2b) …' }), 'linux'),
    ).toBe(true);
  });

  test('a native Linux kernel, an unreadable /proc and every other platform are not WSL', () => {
    expect(isWsl(files({ '/proc/sys/kernel/osrelease': '6.8.0-49-generic\n', '/proc/version': 'Linux version 6.8.0' }), 'linux')).toBe(false);
    expect(isWsl(files({}), 'linux')).toBe(false);
    const microsoft = files({ '/proc/sys/kernel/osrelease': 'microsoft' });
    expect(isWsl(microsoft, 'darwin')).toBe(false);
    expect(isWsl(microsoft, 'win32')).toBe(false);
  });
});

describe('the Windows host address in WSL2 NAT networking', () => {
  const ROUTE = [
    'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
    'eth0\t00000000\t0110A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0',
    'eth0\t0010A8C0\t00000000\t0001\t0\t0\t0\t00F0FFFF\t0\t0\t0',
  ].join('\n');

  test('reads the default gateway from /proc/net/route (little-endian hex)', () => {
    expect(defaultGatewayFromRouteTable(ROUTE)).toBe('192.168.16.1');
    expect(defaultGatewayFromRouteTable(ROUTE.split('\n').slice(0, 1).join('\n'))).toBeNull();
  });

  test('NAT: the gateway; mirrored or not WSL: nothing', () => {
    const read = (path: string) => {
      if (path === '/proc/net/route') return ROUTE;
      throw new Error('ENOENT');
    };
    expect(wslWindowsHostAddress({ container: false, networkingMode: () => 'nat', read, wsl: true })).toBe('192.168.16.1');
    expect(wslWindowsHostAddress({ container: false, networkingMode: () => 'mirrored', read, wsl: true })).toBeNull();
    expect(wslWindowsHostAddress({ container: false, networkingMode: () => 'nat', read, wsl: false })).toBeNull();
  });

  test('fails closed: no wslinfo answer, or a container on a WSL2 kernel, allows nothing', () => {
    const read = (path: string) => {
      if (path === '/proc/net/route') return ROUTE;
      throw new Error('ENOENT');
    };
    // A WSL without wslinfo, or one whose wslinfo failed: the gateway could be the LAN router.
    expect(wslWindowsHostAddress({ container: false, networkingMode: () => null, read, wsl: true })).toBeNull();
    // Docker Desktop's WSL2 backend: the gateway is the Docker bridge, which forwards published ports.
    expect(wslWindowsHostAddress({ container: true, networkingMode: () => 'nat', read, wsl: true })).toBeNull();
  });
});

describe('LT_DEV_WSL_HOST_ADDRESS', () => {
  test('the test setup pins it, so no suite depends on the host', () => {
    expect(process.env.LT_DEV_WSL_HOST_ADDRESS).toBe('none');
    expect(wslWindowsHostAddress()).toBeNull();
  });

  test('an address overrides the detection; anything that is not an address is ignored', () => {
    const before = process.env.LT_DEV_WSL_HOST_ADDRESS;
    try {
      process.env.LT_DEV_WSL_HOST_ADDRESS = '172.22.16.1';
      expect(wslWindowsHostAddress()).toBe('172.22.16.1');
      process.env.LT_DEV_WSL_HOST_ADDRESS = 'fe80::1';
      expect(wslWindowsHostAddress()).toBe('fe80::1');
      process.env.LT_DEV_WSL_HOST_ADDRESS = '1.2.3.4 { respond hi }';
      expect(wslWindowsHostAddress()).toBeNull();
      // Hex digits and dots alone are no address: Caddy would refuse the whole Caddyfile.
      for (const value of ['1.2.3', 'abc', '...', 'fe80::1/32']) {
        process.env.LT_DEV_WSL_HOST_ADDRESS = value;
        expect(wslWindowsHostAddress()).toBeNull();
      }
    } finally {
      process.env.LT_DEV_WSL_HOST_ADDRESS = before;
    }
  });
});

