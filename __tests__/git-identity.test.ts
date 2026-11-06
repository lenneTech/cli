import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { execArgs } from '../src/lib/exec-args';
import { gitIdentityProblem, GitRunner } from '../src/lib/git-identity';

/**
 * Real git, but never the developer's own configuration: a global config file of the test's own
 * and no system config. `user.useConfigOnly` turns off the host-name fallback, which would
 * otherwise make the result depend on the machine.
 */
describe('gitIdentityProblem', () => {
  let dir: string;
  beforeEach(() => {
    // Real path: on macOS tmpdir() is a symlink, and git matches `gitdir:` against the resolved one.
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lt-git-identity-')));
  });
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  function runnerWith(globalConfig: string): GitRunner {
    const configFile = join(dir, 'gitconfig');
    writeFileSync(configFile, globalConfig);
    const env = { ...process.env, GIT_CONFIG_GLOBAL: configFile, GIT_CONFIG_NOSYSTEM: '1' };
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) {
      delete env[key];
    }
    return (command, args, options) => execArgs(command, args, { ...options, env });
  }

  test('reports git’s own reason when no identity is configured', async () => {
    const problem = await gitIdentityProblem(dir, runnerWith('[user]\n\tuseConfigOnly = true\n'));
    expect(problem).toMatch(/^fatal: /);
  });

  test('is null once name and email are set', async () => {
    const problem = await gitIdentityProblem(
      dir,
      runnerWith('[user]\n\tuseConfigOnly = true\n\tname = Test\n\temail = test@example.com\n'),
    );
    expect(problem).toBeNull();
  });

  test('an identity from `includeIf "gitdir:…"` counts, as it would for the commit in the new project', async () => {
    const work = join(dir, 'work');
    mkdirSync(work);
    writeFileSync(join(dir, 'work.cfg'), '[user]\n\tname = Work\n\temail = w@example.com\n');
    const run = runnerWith(
      `[user]\n\tuseConfigOnly = true\n[includeIf "gitdir:${work}/"]\n\tpath = ${join(dir, 'work.cfg')}\n`,
    );
    expect(await gitIdentityProblem(work, run)).toBeNull();
    // The throwaway repository it asks from is gone again.
    expect(readdirSync(work)).toEqual([]);
  });
});
