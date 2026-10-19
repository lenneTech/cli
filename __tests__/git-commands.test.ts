import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { filesystem, system } from 'gluegun';
import { tmpdir } from 'os';
import { join } from 'path';

const src = filesystem.path(__dirname, '..');

/**
 * Environment that keeps git NON-INTERACTIVE, so these tests measure the command
 * rather than the machine's credential state.
 *
 * The suite used to run against THIS working copy and its GitHub remote. Every
 * `lt git …` command reaches a `git fetch`; on a 1Password-backed machine each SSH
 * signature needs an interactive approval, so a fetch stalled for 61 s — past
 * jest's 60 s cap. `IdentityAgent=none` took the agent out of that path.
 *
 * The commands now run in a throwaway clone whose `origin` is a local bare repo
 * (see `createFixture`), so no fetch leaves the machine. The environment stays as
 * a guard for any path that still reaches ssh.
 */
const NON_INTERACTIVE_GIT = {
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o IdentityAgent=none -o IdentitiesOnly=yes -o ConnectTimeout=5',
  GIT_TERMINAL_PROMPT: '0',
};

/**
 * Git variables a hook exports (pre-push in a linked worktree sets GIT_DIR). Inherited
 * by the fixture's git calls, they would operate on the enclosing repository instead
 * of the fixture — see CLAUDE.md "A hook in a linked worktree inherits GIT_DIR".
 */
const HOOK_GIT_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR'];

const isolatedEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...NON_INTERACTIVE_GIT,
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_AUTHOR_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
  };
  for (const name of HOOK_GIT_ENV) {
    delete env[name];
  }
  return env;
};

/**
 * Run `lt` with an argument list, no shell. For names like `x;touch${IFS}PWNED`: `cli` goes
 * through cmd.exe on Windows, which keeps single quotes as part of the argument.
 */
const cliArgs = (args: string[], cwd: string) =>
  execFileSync(process.execPath, [filesystem.path(src, 'bin', 'lt'), ...args], {
    cwd,
    encoding: 'utf8',
    env: isolatedEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** Run `lt <cmd>` inside `cwd` — always a fixture clone, never this repository. */
const cli = async (cmd: string, cwd: string) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`, { cwd, env: isolatedEnv() });

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: isolatedEnv(), stdio: ['ignore', 'pipe', 'pipe'] }).trim();

interface Fixture {
  /** Bare repository acting as `origin`. */
  origin: string;
  root: string;
  /** Second clone, used to push commits the work clone has not seen yet. */
  upstream: string;
  /** Clone the commands run in: branch `feature/demo`, tracking origin, clean. */
  work: string;
}

/**
 * A self-contained remote setup in the OS tmpdir: `origin.git` (bare) with `main`
 * and `feature/demo`, plus two clones. Nothing here touches the CLI's own checkout
 * or the network, whatever branch or state that checkout is in.
 */
const createFixture = (): Fixture => {
  const root = mkdtempSync(join(tmpdir(), 'lt-git-commands-'));
  const origin = join(root, 'origin.git');
  const upstream = join(root, 'upstream');
  const work = join(root, 'work');

  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin], { env: isolatedEnv() });
  execFileSync('git', ['clone', '--quiet', origin, upstream], { env: isolatedEnv(), stdio: 'ignore' });
  git(upstream, 'checkout', '--quiet', '-B', 'main');
  writeFileSync(join(upstream, 'README.md'), '# fixture\n');
  git(upstream, 'add', 'README.md');
  git(upstream, 'commit', '--quiet', '--no-verify', '-m', 'init');
  git(upstream, 'push', '--quiet', '--no-verify', 'origin', 'main');
  git(upstream, 'checkout', '--quiet', '-b', 'feature/demo');
  writeFileSync(join(upstream, 'feature.txt'), 'one\n');
  git(upstream, 'add', 'feature.txt');
  git(upstream, 'commit', '--quiet', '--no-verify', '-m', 'feature: one');
  git(upstream, 'push', '--quiet', '--no-verify', '-u', 'origin', 'feature/demo');

  execFileSync('git', ['clone', '--quiet', '--branch', 'feature/demo', origin, work], { env: isolatedEnv(), stdio: 'ignore' });
  // A local base branch, as in a real checkout (`lt git create` checks local branches).
  git(work, 'branch', '--quiet', '--track', 'main', 'origin/main');
  return { origin, root, upstream, work };
};

export {};

// The `git ssh environment contract` block used to live here, scanning each call
// site's source for a deferring `GIT_SSH_COMMAND` assignment. The default now has
// exactly one definition point (`src/lib/git-env.ts`), so that scan moved to
// `__tests__/git-env.test.ts` and got stronger on the way: deferral is proven by
// CALLING the helper rather than by matching its source text, and a repo-wide
// guard fails if any other file assigns GIT_SSH_COMMAND at all.


describe('Git Commands', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = createFixture();
  });

  afterEach(() => {
    rmSync(fx.root, { force: true, recursive: true });
  });

  describe('lt git update', () => {
    test('rebases the current branch onto its upstream', async () => {
      writeFileSync(join(fx.upstream, 'feature.txt'), 'one\ntwo\n');
      git(fx.upstream, 'commit', '--quiet', '--no-verify', '-am', 'feature: two');
      git(fx.upstream, 'push', '--quiet', '--no-verify', 'origin', 'feature/demo');

      await cli('git update --skip-install', fx.work);

      expect(git(fx.work, 'rev-parse', 'HEAD')).toBe(git(fx.upstream, 'rev-parse', 'HEAD'));
    });

    test('refuses a working copy with uncommitted changes', async () => {
      writeFileSync(join(fx.work, 'feature.txt'), 'local edit\n');
      await expect(cli('git update --skip-install', fx.work)).rejects.toThrow(/unstaged changes|uncommitted/i);
    });

    test('fails on a branch without upstream', async () => {
      git(fx.work, 'checkout', '--quiet', '-b', 'local-only');
      await expect(cli('git update --skip-install', fx.work)).rejects.toThrow();
    });

    test('fails on a detached HEAD', async () => {
      git(fx.work, 'checkout', '--quiet', '--detach');
      await expect(cli('git update --skip-install', fx.work)).rejects.toThrow();
    });
  });

  describe('lt git update --dry-run', () => {
    test('shows dry-run message and changes nothing', async () => {
      const head = git(fx.work, 'rev-parse', 'HEAD');
      const output = await cli('git update --dry-run', fx.work);
      expect(output).toContain('DRY-RUN MODE');
      expect(output).toContain('Current branch:');
      expect(git(fx.work, 'rev-parse', 'HEAD')).toBe(head);
    });
  });

  describe('lt git create --dry-run', () => {
    test('shows what it would create from an existing base', async () => {
      const output = await cli('git create test-branch-dry-run --base main --dry-run', fx.work);
      expect(output).toContain('DRY-RUN MODE');
      expect(output).toContain('Would create branch');
    });

    test('reports a missing base', async () => {
      const output = await cli('git create test-branch-dry-run --base does-not-exist --dry-run', fx.work);
      expect(output).toContain('does not exist');
    });
  });

  describe('lt git force-pull --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git force-pull --dry-run', fx.work);
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git reset --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git reset --dry-run', fx.work);
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git undo --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git undo --dry-run', fx.work);
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git rename --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git rename newname --dry-run', fx.work);
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git squash --dry-run', () => {
    test('previews the squash onto the base', async () => {
      const output = await cli('git squash main --dry-run', fx.work);
      expect(output).toContain('DRY-RUN MODE');
      expect(output).toContain('Would squash 1 commit(s) on branch "feature/demo" into base "main"');
    });
  });

  describe('lt git clear --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git clear --dry-run', fx.work);
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git clean --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git clean --dry-run', fx.work);
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  // Git forbids whitespace in ref names but allows `;`, `|`, `$` and `{}`, so a remote can offer a
  // branch whose name is a command. lt used to interpolate branch names into `system.run` strings,
  // i.e. into /bin/sh, where `x;touch${IFS}PWNED` runs `touch PWNED`. Names are passed with
  // `cliArgs` (no shell), so they reach lt verbatim on every OS, Windows included.
  describe('branch names are never shell syntax', () => {
    test('lt git get checks out a remote branch named like a command without running it', async () => {
      const evil = 'feature/x;touch${IFS}PWNED';
      git(fx.upstream, 'checkout', '--quiet', '-b', evil);
      git(fx.upstream, 'push', '--quiet', '--no-verify', 'origin', evil);

      await cli('git get feature/x --noConfirm', fx.work);

      expect(existsSync(join(fx.work, 'PWNED'))).toBe(false);
      expect(git(fx.work, 'branch', '--show-current')).toBe(evil);
    });

    // `;#` ends the injected command and comments out what the old shell string appended.
    const pushEvil = (name: string) => {
      git(fx.upstream, 'checkout', '--quiet', 'main');
      git(fx.upstream, 'checkout', '--quiet', '-b', name);
      git(fx.upstream, 'push', '--quiet', '--no-verify', 'origin', name);
      git(fx.work, 'fetch', '--quiet', 'origin');
    };

    test('lt git squash --dry-run uses a base named like a command literally', async () => {
      const evil = 'x;touch${IFS}PWNED;#';
      pushEvil(evil);

      cliArgs(['git', 'squash', `origin/${evil}`, '--dry-run'], fx.work);

      expect(existsSync(join(fx.work, 'PWNED'))).toBe(false);
    });

    test('lt git reset resets a current branch named like a command without running it', async () => {
      const evil = 'x;touch${IFS}PWNED;#';
      pushEvil(evil);
      git(fx.work, 'checkout', '--quiet', '-b', evil, '--track', `origin/${evil}`);

      await cli('git reset --noConfirm', fx.work);

      expect(existsSync(join(fx.work, 'PWNED'))).toBe(false);
      expect(git(fx.work, 'branch', '--show-current')).toBe(evil);
    });

    test('lt git rebase rebases onto a base named like a command without running it', async () => {
      const evil = 'x;touch${IFS}PWNED;#';
      pushEvil(evil);
      git(fx.work, 'branch', '--quiet', '--track', evil, `origin/${evil}`);

      cliArgs(['git', 'rebase', evil, '--noConfirm'], fx.work);

      expect(existsSync(join(fx.work, 'PWNED'))).toBe(false);
      expect(git(fx.work, 'branch', '--show-current')).toBe('feature/demo');
    });

    test('lt git create accepts a digits-only branch name, which gluegun parses as a number', async () => {
      await cli('git create 2314 main --noConfirm', fx.work);

      expect(git(fx.work, 'branch', '--show-current')).toBe('2314');
    });

    test('lt git create takes a branch name literally', async () => {
      const evil = 'feat;touch${IFS}PWNED';

      cliArgs(['git', 'create', evil, 'main', '--noConfirm'], fx.work);

      expect(existsSync(join(fx.work, 'PWNED'))).toBe(false);
      expect(git(fx.work, 'branch', '--show-current')).toBe(evil);
    });
  });
});
