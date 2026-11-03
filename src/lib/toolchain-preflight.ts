/**
 * Toolchain checks shared by `lt doctor` and `lt fullstack init`.
 *
 * `lt fullstack init` used to find out about a missing tool by running into it:
 * - no pnpm: the install step died after clone and setup, with the shell's own
 *   "command not found" (on Windows the localized cmd.exe text) and no hint;
 * - no git identity: the initial commit failed AFTER the multi-minute install,
 *   and the half-built workspace blocked the re-run ("There's already a folder").
 * A machine at zero (the 2026-11 Windows workshop) hits both. These checks name
 * the missing piece and the command that fixes it, before the work starts.
 *
 * Lookup and git calls are injectable, so every branch runs in a test on any OS.
 */
import { execArgs } from './exec-args';
import { findExecutable } from './platform';

export interface ToolchainDeps {
  /** Resolve a binary on PATH, `null` when absent. Default: {@link findExecutable}. */
  findExecutable?: (name: string) => null | string;
  /** Run git with an argument list, rejecting on a non-zero exit. Default: {@link execArgs}. */
  git?: (args: string[], cwd: string) => Promise<string>;
  /** Default: `process.platform`. */
  platform?: NodeJS.Platform;
}

/** A missing prerequisite, with the commands that fix it. */
export interface ToolchainIssue {
  /** Commands to run, one per line, in order. */
  fix: string[];
  id: 'git-identity' | 'git-missing' | 'pnpm-missing';
  /** One line: what is missing and what needs it. */
  message: string;
}

/**
 * Whether git can commit in `cwd` without asking who the author is.
 *
 * Asks git itself (`git var GIT_COMMITTER_IDENT` / `GIT_AUTHOR_IDENT`) instead of reading
 * `user.name`/`user.email`: `git var` resolves the identity exactly like `git commit` does
 * (config files, `includeIf` sections for this directory, `GIT_*` / `EMAIL` variables,
 * auto-detection) and fails exactly when the commit would. Reading the two keys would refuse
 * a developer whose identity comes from an `includeIf "gitdir:…"` file, and that condition is
 * only evaluated inside the repository, so callers pass the new repository as `cwd`.
 *
 * @returns `null` when git can commit, otherwise the issue with git's first error line
 */
export async function checkGitIdentity(cwd: string, deps: ToolchainDeps = {}): Promise<null | ToolchainIssue> {
  const git = deps.git ?? ((args: string[], dir: string) => execArgs('git', args, { cwd: dir }));
  try {
    await git(['var', 'GIT_COMMITTER_IDENT'], cwd);
    await git(['var', 'GIT_AUTHOR_IDENT'], cwd);
    return null;
  } catch (err) {
    const detail = firstMeaningfulLine((err as { stderr?: string })?.stderr ?? (err as Error)?.message ?? '');
    return {
      fix: gitIdentityFix(),
      id: 'git-identity',
      message: `git has no author identity, so it cannot commit${detail ? ` (${detail})` : ''}.`,
    };
  }
}

/**
 * Tools `lt fullstack init` needs on PATH before it clones anything.
 *
 * pnpm is required for the classic flow: lt-monorepo ships a `pnpm-lock.yaml` and
 * `packageManager: pnpm@…`, so the detected manager is pnpm whatever the user configured.
 * The experimental `--next` flow skips the install and leaves it to the user.
 *
 * @param needs - Which tools the caller's flow uses
 * @returns The missing ones, in the order the user should fix them
 */
export function findMissingTools(needs: { pnpm: boolean }, deps: ToolchainDeps = {}): ToolchainIssue[] {
  const lookup = deps.findExecutable ?? ((name: string) => findExecutable(name));
  const platform = deps.platform ?? process.platform;
  const issues: ToolchainIssue[] = [];
  if (!lookup('git')) {
    issues.push({ fix: [gitInstallHint(platform)], id: 'git-missing', message: 'git is not installed (or not on PATH).' });
  }
  if (needs.pnpm && !lookup('pnpm')) {
    issues.push({
      fix: [pnpmInstallHint()],
      id: 'pnpm-missing',
      message: 'pnpm is not installed (or not on PATH). lt fullstack init installs the workspace with pnpm.',
    });
  }
  return issues;
}

/** The two commands that set a git identity for every repository of this user. */
export function gitIdentityFix(): string[] {
  return ['git config --global user.name "Your Name"', 'git config --global user.email "you@example.com"'];
}

/**
 * Install command for git on this platform. The Windows id is the one git-scm.com documents.
 */
export function gitInstallHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return 'winget install --id Git.Git -e --source winget';
  }
  if (platform === 'darwin') {
    return 'xcode-select --install';
  }
  return 'https://git-scm.com/downloads/linux';
}

/**
 * Install command for pnpm. `npm install -g` needs no admin rights on any platform and puts
 * the shim next to `lt`; `corepack enable` writes next to node.exe, which on Windows sits in
 * `C:\Program Files` and needs an elevated shell.
 */
export function pnpmInstallHint(): string {
  return 'npm install -g pnpm';
}

/** First non-empty line, without git's `fatal: ` prefix. */
function firstMeaningfulLine(text: string): string {
  const line = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !/^\*\*\* Please tell me who you are/.test(l) && !/^Run$/.test(l));
  return (line ?? '').replace(/^fatal:\s*/, '');
}
