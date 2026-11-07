import { privilegedPortProblem } from '../src/lib/dev-privileged-ports';

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

  test("the capability on the binary (Caddy's own apt package sets it) is enough", async () => {
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
