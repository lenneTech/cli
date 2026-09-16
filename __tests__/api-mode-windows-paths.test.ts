import { ApiMode } from '../src/extensions/api-mode';
import { envBlocksWithoutGraphQlDisabled } from '../src/lib/config-env-graphql';

const { filesystem } = require('gluegun');

/**
 * The Windows failure reproduced on a POSIX host.
 *
 * `filesystem.find` is fs-jetpack's and returns `pathUtil.relative(cwd, path)`, so on
 * Windows every entry is backslash-separated. `api-mode.ts` matched the config file
 * with `endsWith('/config.env.ts')`, which is false there — the `// #region graphql`
 * block was deleted without its `graphQl: false` replacement, and the generated REST
 * project booted with GraphQL enabled.
 *
 * The toolbox below hands the extension Windows-shaped paths while translating them
 * back for the actual file operations, so the mistake is visible without a Windows
 * machine. It is the separator that matters here, not the line ending: the file on the
 * laptop was LF.
 */
function windowsPathToolbox(): any {
  const toWindows = (path: string): string => path.replace(/\//g, '\\');
  const toHost = (path: string): string => path.replace(/\\/g, '/');

  return {
    filesystem: new Proxy(filesystem, {
      get(target: any, property: string) {
        if (property === 'find') {
          return (dir: string, options: unknown) => (target.find(toHost(dir), options) || []).map(toWindows);
        }
        const value = target[property];
        if (typeof value !== 'function') {
          return value;
        }
        // Every other call gets host paths back, as Windows' own APIs would.
        return (...args: unknown[]) =>
          value.apply(
            target,
            args.map((arg) => (typeof arg === 'string' ? toHost(arg) : arg)),
          );
      },
    }),
  };
}

describe('REST conversion with Windows-shaped paths from filesystem.find', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(filesystem.cwd(), `__tests__/temp-win-paths-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filesystem.dir(filesystem.path(tempDir, 'src'));
    filesystem.write(filesystem.path(tempDir, 'package.json'), { name: 'p', scripts: {}, version: '0.0.1' }, { jsonIndent: 2 });
    filesystem.write(filesystem.path(tempDir, 'api-mode.manifest.json'), {
      modes: { graphql: { filePatterns: [], packages: [], regionMarker: 'graphql', scripts: [] } },
    });
    filesystem.write(
      filesystem.path(tempDir, 'src', 'config.env.ts'),
      [
        "import { getEnvironmentConfig, IServerOptions } from '@lenne.tech/nest-server';",
        '',
        'const config: { [env: string]: IServerOptions } = {',
        // `port` comes FIRST on purpose: the region strip writes `graphQl: false`
        // where the region was (after `port`), while the final repair inserts it as
        // the block's first property. The order therefore says which one ran.
        '  local: {',
        '    port: 3000,',
        '    // #region graphql',
        '    graphQl: {',
        '      driver: { playground: true },',
        '    },',
        '    // #endregion graphql',
        '  },',
        '  production: {',
        '    port: 3001,',
        '    // #region graphql',
        '    graphQl: {',
        '      driver: { playground: false },',
        '    },',
        '    // #endregion graphql',
        '  },',
        '};',
        '',
        'export default getEnvironmentConfig({ config });',
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    filesystem.remove(tempDir);
  });

  it('replaces the region in place — the path check must match backslash paths', async () => {
    await new ApiMode(windowsPathToolbox()).processApiMode(tempDir, 'Rest');

    const content = filesystem.read(filesystem.path(tempDir, 'src', 'config.env.ts'));
    expect(envBlocksWithoutGraphQlDisabled(content)).toEqual([]);
    expect(content.match(/graphQl: false/g)).toHaveLength(2);
    expect(content).not.toContain('playground');
    // `graphQl: false` sits where the region was. If the path check missed the file,
    // the region would have been deleted and only the final repair would have put the
    // switch back — as the block's FIRST property, before `port`.
    expect(content).toMatch(/port: 3000,\s*\n\s*graphQl: false,/);
    expect(content).toMatch(/port: 3001,\s*\n\s*graphQl: false,/);
  });

  it('proves the fixture really delivers backslash paths', () => {
    // Otherwise the test above would pass for the wrong reason.
    const found = windowsPathToolbox().filesystem.find(filesystem.path(tempDir, 'src'), { matching: '**/*.ts' });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((file: string) => file.includes('\\'))).toBe(true);
    expect(found.some((file: string) => file.endsWith('/config.env.ts'))).toBe(false);
  });
});
