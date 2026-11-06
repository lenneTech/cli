import { isWsl } from '../src/lib/wsl';

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
