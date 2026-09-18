import { disableGraphQlInEveryEnvBlock, envBlocksWithoutGraphQlDisabled } from '../src/lib/config-env-graphql';

/**
 * `CoreModule.forRoot` reads a missing `graphQl` as ENABLED. A REST project whose
 * `config.env.ts` lost the switch therefore builds a GraphQL schema on boot and dies
 * with `Cannot determine a GraphQL output type for the "arguments"` — at start time,
 * long after the generator reported success. That is what a Windows project from lt
 * 1.47.0 did (2026-09-16).
 */
const config = (blocks: string, eol = '\n'): string =>
  [
    "import { getEnvironmentConfig, IServerOptions } from '@lenne.tech/nest-server';",
    '',
    'const config: { [env: string]: IServerOptions } = {',
    blocks,
    '};',
    '',
    'export default getEnvironmentConfig({ config });',
    '',
  ].join(eol);

describe('disableGraphQlInEveryEnvBlock', () => {
  it('adds the switch to every block that lost it — the Windows case', () => {
    const source = config(['  local: {', '    port: 3000,', '  },', '  develop: {', '    port: 3000,', '  },'].join('\n'));

    const result = disableGraphQlInEveryEnvBlock(source);

    expect(result.added).toEqual(['local', 'develop']);
    expect(result.content).toContain('graphQl: false');
    expect(envBlocksWithoutGraphQlDisabled(result.content)).toEqual([]);
    expect(result.content.match(/graphQl: false/g)).toHaveLength(2);
  });

  it('replaces a surviving graphQl object and leaves a correct file alone', () => {
    const withObject = config(['  local: {', '    graphQl: { maxComplexity: 1000 },', '  },'].join('\n'));
    expect(disableGraphQlInEveryEnvBlock(withObject).content).toContain('graphQl: false');

    const alreadyFine = config(['  local: {', '    graphQl: false,', '  },'].join('\n'));
    const result = disableGraphQlInEveryEnvBlock(alreadyFine);
    expect(result.added).toEqual([]);
    expect(result.content).toBe(alreadyFine); // untouched, byte for byte
  });

  it('keeps CRLF line endings', () => {
    const source = config(['  local: {', '    port: 3000,', '  },'].join('\r\n'), '\r\n');

    const result = disableGraphQlInEveryEnvBlock(source);

    expect(result.content).toContain('graphQl: false');
    expect(result.content).not.toMatch(/[^\r]\n/);
    expect(envBlocksWithoutGraphQlDisabled(result.content)).toEqual([]);
  });

  it('covers the merge() shape and ignores nested objects', () => {
    const source = [
      "import { merge } from 'lodash';",
      '',
      'const config = merge(',
      '  { default: { mongoose: { uri: "x" }, port: 3000 } },',
      '  { production: { port: 80 } },',
      ');',
      '',
    ].join('\n');

    const result = disableGraphQlInEveryEnvBlock(source);

    // `mongoose` is a property of an env block, not an env block itself.
    expect(result.added).toEqual(['default', 'production']);
    expect(result.content.match(/graphQl: false/g)).toHaveLength(2);
  });
});

describe('envBlocksWithoutGraphQlDisabled', () => {
  it('names the blocks that would boot with GraphQL enabled', () => {
    const source = config(
      ['  local: {', '    graphQl: false,', '  },', '  develop: {', '    port: 3000,', '  },', '  test: {', '    graphQl: { maxComplexity: 1 },', '  },'].join('\n'),
    );
    expect(envBlocksWithoutGraphQlDisabled(source)).toEqual(['develop', 'test']);
  });

  it('is quiet for a fully disabled file', () => {
    expect(envBlocksWithoutGraphQlDisabled(config(['  local: {', '    graphQl: false,', '  },'].join('\n')))).toEqual([]);
  });
});
