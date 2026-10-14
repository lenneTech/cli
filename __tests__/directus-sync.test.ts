import { join } from 'path';

import {
  buildDirectusSyncArgs,
  DIRECTUS_CLI_VERSION,
  isDirectusSyncAction,
  passthroughArgs,
  resolveDirectusCli,
  stripLtFlags,
} from '../src/lib/directus-sync';

describe('buildDirectusSyncArgs', () => {
  test('pull forwards options and gets no mode', () => {
    expect(buildDirectusSyncArgs('pull', ['--from', 'dev'], false)).toEqual({ args: ['sync', 'pull', '--from', 'dev'] });
  });

  test('diff and push default to merge', () => {
    expect(buildDirectusSyncArgs('diff', ['--to', 'prod'], false)).toEqual({
      args: ['sync', 'diff', '--to', 'prod', '--mode', 'merge'],
    });
    expect(buildDirectusSyncArgs('push', ['--to', 'prod'], false)).toEqual({
      args: ['sync', 'push', '--to', 'prod', '--mode', 'merge'],
    });
  });

  test('an explicit mode is kept', () => {
    expect(buildDirectusSyncArgs('push', ['--mode=add'], false)).toEqual({ args: ['sync', 'push', '--mode=add'] });
  });

  test('non-interactive push disables prompts and confirms the apply', () => {
    expect(buildDirectusSyncArgs('push', ['--to', 'prod'], true)).toEqual({
      args: ['--no-interactive', 'sync', 'push', '--to', 'prod', '--mode', 'merge', '--yes'],
    });
  });

  test('non-interactive diff gets no --yes', () => {
    expect(buildDirectusSyncArgs('diff', [], true)).toEqual({
      args: ['--no-interactive', 'sync', 'diff', '--mode', 'merge'],
    });
  });

  test.each([
    [['--mode', 'mirror']],
    [['--mode=mirror']],
    [['--mode', 'MIRROR']],
    [['--dangerously-allow-delete']],
    [['--dangerously-allow-delete=true']],
    [['--dangerously-allow-delete', 'false']],
  ])('non-interactive push refuses deletions: %j', (passthrough) => {
    expect(buildDirectusSyncArgs('push', passthrough, true)).toHaveProperty('error');
  });

  test('interactive push may mirror; d6s asks for the deletion itself', () => {
    expect(buildDirectusSyncArgs('push', ['--mode', 'mirror'], false)).toEqual({
      args: ['sync', 'push', '--mode', 'mirror'],
    });
  });

  test('non-interactive mirror diff is allowed, it applies nothing', () => {
    expect(buildDirectusSyncArgs('diff', ['--mode', 'mirror'], true)).toEqual({
      args: ['--no-interactive', 'sync', 'diff', '--mode', 'mirror'],
    });
  });

  test('lt flags never reach d6s', () => {
    expect(buildDirectusSyncArgs('pull', ['--noConfirm', '--from', 'dev'], false)).toEqual({
      args: ['sync', 'pull', '--from', 'dev'],
    });
  });
});

describe('stripLtFlags', () => {
  test.each([
    [['--noConfirm'], []],
    [['--noConfirm=true'], []],
    [['--noConfirm', 'true', '--to', 'x'], ['--to', 'x']],
    [['--fromGluegunMenu', '--no-flows'], ['--no-flows']],
  ])('%j -> %j', (input, expected) => {
    expect(stripLtFlags(input)).toEqual(expected);
  });
});

describe('passthroughArgs', () => {
  test('takes everything after the command without the action', () => {
    expect(passthroughArgs(['directus', 'sync', 'push', '--to', 'prod'], 'push')).toEqual(['--to', 'prod']);
  });

  test('keeps options given before the action', () => {
    expect(passthroughArgs(['di', 's', '--from', 'dev', 'pull', '--no-flows'], 'pull')).toEqual([
      '--from',
      'dev',
      '--no-flows',
    ]);
  });

  test('returns nothing when started from the menu', () => {
    expect(passthroughArgs([], 'diff')).toEqual([]);
  });
});

describe('isDirectusSyncAction', () => {
  test('accepts only pull, diff and push', () => {
    expect(['pull', 'diff', 'push'].every(isDirectusSyncAction)).toBe(true);
    expect(isDirectusSyncAction('apply')).toBe(false);
    expect(isDirectusSyncAction(undefined)).toBe(false);
  });
});

describe('resolveDirectusCli', () => {
  const cwd = '/project';

  test('a local install wins', () => {
    const local = join(cwd, 'node_modules', '.bin', 'd6s');
    const cli = resolveDirectusCli(cwd, { env: { PATH: '' }, isExecutableFile: (p) => p === local });
    expect(cli).toEqual({ args: [], command: local });
  });

  test('falls back to npx with the pinned version', () => {
    const cli = resolveDirectusCli(cwd, { env: { PATH: '' }, isExecutableFile: () => false });
    expect(cli).toEqual({
      args: ['--yes', `--package=@directus/cli@${DIRECTUS_CLI_VERSION}`, 'd6s'],
      command: 'npx',
    });
  });
});
