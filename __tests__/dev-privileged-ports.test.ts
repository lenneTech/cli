import {
  privilegedPortProblem,
  processMayBindPrivilegedPorts,
  runningCaddyMissesCapability,
} from '../src/lib/dev-privileged-ports';

const linux = (overrides: Record<string, unknown> = {}) => ({
  platform: 'linux' as const,
  readFile: () => '1024\n',
  realpath: (path: string) => (path === '/home/linuxbrew/.linuxbrew/bin/caddy' ? '/home/linuxbrew/.linuxbrew/Cellar/caddy/2.10.0/bin/caddy' : path),
  run: async () => '',
  uid: 1000,
  ...overrides,
});

describe('privilegedPortProblem (Linux, ports 80/443)', () => {
  test('macOS and Windows need nothing', async () => {
    expect(await privilegedPortProblem('/usr/bin/caddy', { platform: 'darwin' })).toBeNull();
    expect(await privilegedPortProblem('C:\\caddy.exe', { platform: 'win32' })).toBeNull();
  });

  test('root, or a sysctl that already allows port 80, needs nothing', async () => {
    expect(await privilegedPortProblem('/usr/bin/caddy', linux({ uid: 0 }))).toBeNull();
    expect(await privilegedPortProblem('/usr/bin/caddy', linux({ readFile: () => '0\n' }))).toBeNull();
  });

  test('the capability on the binary is enough', async () => {
    const run = async () => '/usr/bin/caddy cap_net_bind_service=ep\n';
    expect(await privilegedPortProblem('/usr/bin/caddy', linux({ run }))).toBeNull();
  });

  test('without it: setcap on the REAL file, not on the PATH symlink', async () => {
    const problem = await privilegedPortProblem('/home/linuxbrew/.linuxbrew/bin/caddy', linux());
    expect(problem?.realBin).toBe('/home/linuxbrew/.linuxbrew/Cellar/caddy/2.10.0/bin/caddy');
    expect(problem?.commands).toEqual([
      'sudo setcap cap_net_bind_service=+ep /home/linuxbrew/.linuxbrew/Cellar/caddy/2.10.0/bin/caddy',
    ]);
  });

  test('a sysctl allowing only 443 is not enough: Caddy binds 80 too', async () => {
    expect(await privilegedPortProblem('/usr/bin/caddy', linux({ readFile: () => '443\n' }))).not.toBeNull();
  });

  test('no getcap installed: names the package, then setcap', async () => {
    const run = async () => {
      throw Object.assign(new Error('spawn getcap ENOENT'), { code: 'ENOENT' });
    };
    const problem = await privilegedPortProblem('/usr/bin/caddy', linux({ run }));
    expect(problem?.commands[0]).toContain('libcap2-bin');
    expect(problem?.commands[1]).toBe('sudo setcap cap_net_bind_service=+ep /usr/bin/caddy');
  });

  test('a path with spaces is quoted for the shell', async () => {
    const problem = await privilegedPortProblem('/opt/my tools/caddy', linux());
    expect(problem?.commands).toEqual(["sudo setcap cap_net_bind_service=+ep '/opt/my tools/caddy'"]);
  });
});

describe('processMayBindPrivilegedPorts (a RUNNING Caddy, CapEff)', () => {
  const status = (capEff: string) => () => `Name:\tcaddy\nCapInh:\t0000000000000000\nCapEff:\t${capEff}\n`;

  test('bit 10 (CAP_NET_BIND_SERVICE) set: yes, also with every capability (root)', () => {
    expect(processMayBindPrivilegedPorts(42, status('0000000000000400'))).toBe(true);
    expect(processMayBindPrivilegedPorts(42, status('000001ffffffffff'))).toBe(true);
  });

  test('started before setcap: no capability in effect', () => {
    expect(processMayBindPrivilegedPorts(42, status('0000000000000000'))).toBe(false);
    expect(processMayBindPrivilegedPorts(42, status('0000000000000800'))).toBe(false);
  });

  test('unreadable or without a CapEff line: unknown, never a verdict', () => {
    expect(
      processMayBindPrivilegedPorts(42, () => {
        throw new Error('ENOENT');
      }),
    ).toBeNull();
    expect(processMayBindPrivilegedPorts(42, () => 'Name:\tcaddy\n')).toBeNull();
  });
});

describe('runningCaddyMissesCapability (doctor: restart after setcap?)', () => {
  /** sysctl and /proc/<pid>/status in one reader, as on a real Linux. */
  const reader = (portStart: string, capEff: string) => (path: string) =>
    path.endsWith('ip_unprivileged_port_start') ? `${portStart}\n` : `Name:\tcaddy\nCapEff:\t${capEff}\n`;
  const withCap = async () => '/usr/bin/caddy cap_net_bind_service=ep\n';

  test('the file has the capability, the running Caddy does not: started before setcap', async () => {
    expect(
      await runningCaddyMissesCapability('/usr/bin/caddy', 42, linux({ readFile: reader('1024', '0000000000000000'), run: withCap })),
    ).toBe(true);
    expect(
      await runningCaddyMissesCapability('/usr/bin/caddy', 42, linux({ readFile: reader('1024', '0000000000000400'), run: withCap })),
    ).toBe(false);
  });

  test('the sysctl allows the ports (Docker default 0): no bit, and no restart would set one', async () => {
    expect(
      await runningCaddyMissesCapability('/usr/bin/caddy', 42, linux({ readFile: reader('0', '0000000000000000'), run: withCap })),
    ).toBe(false);
  });

  test('no capability on the file, root, or no pid: not this check (setcap or nothing is the answer)', async () => {
    const zero = reader('1024', '0000000000000000');
    expect(await runningCaddyMissesCapability('/usr/bin/caddy', 42, linux({ readFile: zero }))).toBe(false);
    expect(await runningCaddyMissesCapability('/usr/bin/caddy', 42, linux({ readFile: zero, run: withCap, uid: 0 }))).toBe(false);
    expect(await runningCaddyMissesCapability('/usr/bin/caddy', undefined, linux({ readFile: zero, run: withCap }))).toBe(false);
  });
});
