/**
 * Git author and committer identity, checked before a scaffolder writes anything.
 *
 * `lt fullstack init` commits as its last step. Without `user.name` / `user.email` that commit
 * failed with "Author identity unknown" after the whole workspace had been built and installed:
 * exit 1, and a directory a second run then refused as "already exists".
 */
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

import { execArgs } from './exec-args';

/** Runs a program with an argument list and no shell, like {@link execArgs}. Injectable for tests. */
export type GitRunner = (command: string, args: readonly string[], options: { cwd: string }) => Promise<string>;

/** What to run when {@link gitIdentityProblem} reports one. */
export const GIT_IDENTITY_FIX = [
  'git config --global user.name "Your Name"',
  'git config --global user.email "you@example.com"',
];

/**
 * Why a `git commit` in a new repository below `parentDir` would fail for lack of an identity, or
 * null when it would not.
 *
 * `git var GIT_AUTHOR_IDENT` / `GIT_COMMITTER_IDENT` resolve the identity the way `git commit` does
 * (config, the `GIT_AUTHOR_*` / `GIT_COMMITTER_*` / `EMAIL` variables, the host-name fallback,
 * `user.useConfigOnly`) and fail with the same message. They run in a throwaway repository created
 * in `parentDir` and removed afterwards: an `includeIf "gitdir:~/work/"` applies only inside a
 * repository, so asked from the (non-repository) parent, git refused an identity the commit in
 * the new project would have had.
 * @param parentDir - Directory the project will be created in
 * @param run - Program runner (tests)
 * @returns The `fatal:` line of git, or null
 */
export async function gitIdentityProblem(parentDir: string, run: GitRunner = execArgs): Promise<null | string> {
  let probe: string | undefined;
  try {
    probe = mkdtempSync(join(parentDir, '.lt-git-identity-'));
    await run('git', ['init', '-q'], { cwd: probe });
  } catch {
    // Not writable, or no git: ask from the parent; the commit later reports anything this misses.
    if (probe) rmSync(probe, { force: true, recursive: true });
    probe = undefined;
  }
  try {
    for (const variable of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
      try {
        await run('git', ['var', variable], { cwd: probe ?? parentDir });
      } catch (err) {
        const { message = '', stderr = '' } = err as { message?: string; stderr?: string };
        const lines = `${stderr}\n${message}`.split('\n').map((line) => line.trim());
        return (
          lines.find((line) => line.startsWith('fatal:')) ?? lines.find(Boolean) ?? 'git cannot determine an identity'
        );
      }
    }
    return null;
  } finally {
    if (probe) rmSync(probe, { force: true, recursive: true });
  }
}
