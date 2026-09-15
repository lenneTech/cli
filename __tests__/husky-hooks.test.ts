import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * In a linked worktree git exports GIT_DIR to hooks. `pre-push` runs the test
 * suite, whose git calls in temporary repos then operate on THIS repository:
 * one push renamed the branch being pushed, committed fixtures onto it, created
 * test branches and set core.bare=true in the shared config. The hook must drop
 * that environment before any test runs.
 */
describe('.husky/pre-push', () => {
  const hook = readFileSync(join(__dirname, '..', '.husky', 'pre-push'), 'utf8');

  it('unsets the git hook environment before running the tests', () => {
    const unset = /^unset\b(.*)$/m.exec(hook);
    expect(unset).not.toBeNull();
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
      expect(unset?.[1].split(/\s+/)).toContain(name);
    }
    expect(unset!.index).toBeLessThan(hook.indexOf('npm run test'));
  });

  it('does not source the Husky 8 loader, which only exists in the original checkout', () => {
    expect(hook).not.toContain('husky.sh');
  });
});
