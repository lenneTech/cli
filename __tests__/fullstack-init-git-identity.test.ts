/**
 * `lt fullstack init` without a git identity refuses before it writes anything.
 *
 * It used to find out at the initial commit, its last step: the workspace was cloned, built and
 * installed, then `git commit` failed with "Author identity unknown", exit 1, and the directory
 * was left behind for the next run to refuse as "already exists".
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('fullstack init without a git identity', () => {
  test('stops with the git config commands and leaves no directory behind', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lt-identity-'));
    try {
      // The test's own global config, no system config: never the developer's identity.
      const configFile = join(tmp, 'gitconfig');
      writeFileSync(configFile, '[user]\n\tuseConfigOnly = true\n');
      const env = { ...process.env, GIT_CONFIG_GLOBAL: configFile, GIT_CONFIG_NOSYSTEM: '1' };
      for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) {
        delete env[key];
      }
      const result = spawnSync(
        process.execPath,
        [
          join(__dirname, '..', 'bin', 'lt'),
          'fullstack',
          'init',
          '--name',
          'shop',
          '--frontend',
          'nuxt',
          '--api-mode',
          'Rest',
          '--noConfirm',
        ],
        { cwd: tmp, encoding: 'utf8', env, timeout: 120_000 },
      );
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).toBe(1);
      expect(output).toContain('git cannot create the initial commit');
      expect(output).toContain('git config --global user.email "you@example.com"');
      expect(existsSync(join(tmp, 'shop'))).toBe(false);
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  }, 180_000);
});
