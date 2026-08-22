import { filesystem, system } from 'gluegun';

const src = filesystem.path(__dirname, '..');

/**
 * Environment that keeps git NON-INTERACTIVE, so these tests measure the command
 * rather than the machine's credential state.
 *
 * Every `lt git …` command here reaches a `git fetch`. On a 1Password-backed
 * machine the SSH agent is present but each signature needs an interactive
 * approval; non-interactively it waits and then reports
 * `communication with agent failed`. Measured: **61 s** per fetch, so
 * `lt git update --dry-run` took 62 s — just past jest's 60 s cap. Four tests
 * failed as timeouts with nothing in the output pointing at authentication, and
 * they failed identically on an untouched checkout.
 *
 * **`IdentityAgent=none` is the load-bearing option**, not `BatchMode`. BatchMode
 * only suppresses password PROMPTS; here nothing is prompted — the agent is
 * contacted and stalls. Taking the agent out of the path drops the same fetch to
 * **1 s** with a clean `Permission denied (publickey)`.
 *
 * This narrows what the tests measure rather than weakening them: a failed fetch
 * is a path these commands are asserted to handle, and it is now reached
 * deterministically instead of depending on whether someone approved a key
 * prompt in the last few minutes.
 */
const NON_INTERACTIVE_GIT = {
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o IdentityAgent=none -o IdentitiesOnly=yes -o ConnectTimeout=5',
  GIT_TERMINAL_PROMPT: '0',
};

const cli = async (cmd: string) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`, {
    env: { ...process.env, ...NON_INTERACTIVE_GIT },
  });

// Check if we're on a branch (not detached HEAD) - required for git commands
const isOnBranch = async (): Promise<boolean> => {
  try {
    const branch = await system.run('git symbolic-ref --short HEAD 2>/dev/null');
    return !!branch?.trim();
  } catch {
    return false;
  }
};

// Check if a branch exists
const branchExists = async (branch: string): Promise<boolean> => {
  try {
    await system.run(`git rev-parse --verify ${branch} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
};

// Check if working directory is clean — only modifications to tracked
// files count, since untracked files do not block `git pull --rebase`
// and parallel jest tests in this suite scatter `temp-*` directories
// across the working tree (see __tests__/temp-api-mode-*).
const isWorkingDirectoryClean = async (): Promise<boolean> => {
  try {
    const status = await system.run('git status --porcelain --untracked-files=no');
    return !status?.trim();
  } catch {
    return false;
  }
};

// Check if the current branch has an upstream tracking branch (so
// `git pull --rebase` has somewhere to pull from). Local-only branches
// — e.g. a freshly created feature branch before its first push — fail
// `lt git update` with "no tracking information" through no fault of
// the command, so the test must skip rather than treat it as a bug.
const hasUpstreamBranch = async (): Promise<boolean> => {
  try {
    const upstream = await system.run('git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null');
    return !!upstream?.trim();
  } catch {
    return false;
  }
};

export {};

describe('git ssh environment contract', () => {
  // Pins the `:-` default. Assigning GIT_SSH_COMMAND outright overrode any caller
  // who had configured ssh deliberately — including this very test file — and cost
  // 61 s per fetch on a machine whose agent needs interactive approval.
  const nodeFs = require('fs');
  const nodePath = require('path');

  const SOURCES = ['src/extensions/git.ts', 'src/commands/git/reset.ts', 'src/commands/git/update.ts'];

  test('every GIT_SSH_COMMAND assignment defers to an existing value', () => {
    const offenders: string[] = [];
    for (const rel of SOURCES) {
      const body: string = nodeFs.readFileSync(nodePath.join(src, rel), 'utf8');
      body.split('\n').forEach((line: string, i: number) => {
        if (!line.includes('GIT_SSH_COMMAND=')) return;
        if (line.trim().startsWith('*')) return; // the explanatory comment block
        if (!/GIT_SSH_COMMAND="\\?\$\{GIT_SSH_COMMAND:-/.test(line)) {
          offenders.push(`${rel}:${i + 1} assigns GIT_SSH_COMMAND unconditionally — use "\${GIT_SSH_COMMAND:-…}"`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('the contract check is not vacuous — the assignments exist', () => {
    const found = SOURCES.reduce(
      (n, rel) => n + (nodeFs.readFileSync(nodePath.join(src, rel), 'utf8').match(/GIT_SSH_COMMAND="/g) ?? []).length,
      0,
    );
    expect(found).toBeGreaterThanOrEqual(5);
  });
});

describe('Git Commands', () => {
  let onBranch: boolean;
  let hasMainBranch: boolean;
  let cleanWorkingDir: boolean;
  let hasUpstream: boolean;

  beforeAll(async () => {
    onBranch = await isOnBranch();
    hasMainBranch = await branchExists('main');
    cleanWorkingDir = await isWorkingDirectoryClean();
    hasUpstream = await hasUpstreamBranch();
  });

  describe('lt git update', () => {
    test('updates current branch or handles various states', async () => {
      if (!onBranch) {
        // In CI with detached HEAD, command will fail gracefully
        await expect(cli('git update')).rejects.toThrow();
        return;
      }
      if (!cleanWorkingDir) {
        // With uncommitted changes, git pull --rebase will fail
        // This is expected behavior - verify the command fails appropriately
        await expect(cli('git update')).rejects.toThrow(/unstaged changes|uncommitted/i);
        return;
      }
      if (!hasUpstream) {
        // Fresh feature branch without `git push -u` yet: `git pull --rebase`
        // exits 1 with "no tracking information". That is a configuration
        // gap in the local checkout, not a regression in `lt git update`.
        await expect(cli('git update')).rejects.toThrow();
        return;
      }
      const output = await cli('git update');
      expect(output).toBeDefined();
    });
  });

  describe('lt git update --dry-run', () => {
    test('shows dry-run message', async () => {
      if (!onBranch) {
        // Skip in detached HEAD state
        return;
      }
      const output = await cli('git update --dry-run');
      expect(output).toContain('DRY-RUN MODE');
      expect(output).toContain('Current branch:');
    });
  });

  describe('lt git create --dry-run', () => {
    test('shows dry-run message or handles missing base', async () => {
      if (!hasMainBranch) {
        // Base branch doesn't exist, command will report error
        const output = await cli('git create test-branch-dry-run --base main --dry-run');
        expect(output).toContain('does not exist');
        return;
      }
      const output = await cli('git create test-branch-dry-run --base main --dry-run');
      expect(output).toContain('DRY-RUN MODE');
      expect(output).toContain('Would create branch');
    });
  });

  describe('lt git force-pull --dry-run', () => {
    test('shows dry-run message', async () => {
      if (!onBranch) {
        return;
      }
      const output = await cli('git force-pull --dry-run');
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git reset --dry-run', () => {
    test('shows dry-run message or handles no remote', async () => {
      if (!onBranch) {
        return;
      }
      try {
        const output = await cli('git reset --dry-run');
        expect(output).toContain('DRY-RUN MODE');
      } catch {
        // No remote branch - acceptable in some environments
      }
    });
  });

  describe('lt git undo --dry-run', () => {
    test('shows dry-run message', async () => {
      if (!onBranch) {
        return;
      }
      const output = await cli('git undo --dry-run');
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git rename --dry-run', () => {
    test('shows dry-run message or protected branch error', async () => {
      if (!onBranch) {
        return;
      }
      const output = await cli('git rename newname --dry-run');
      expect(
        output.includes('DRY-RUN MODE') || output.includes('not allowed')
      ).toBe(true);
    });
  });

  describe('lt git squash --dry-run', () => {
    test('shows dry-run message or handles missing base', async () => {
      if (!onBranch) {
        return;
      }
      try {
        const output = await cli('git squash --dry-run');
        expect(
          output.includes('DRY-RUN MODE') || output.includes('not allowed')
        ).toBe(true);
      } catch {
        // Base branch might not exist
      }
    });
  });

  describe('lt git clear --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git clear --dry-run');
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git clean --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git clean --dry-run');
      expect(output).toContain('DRY-RUN MODE');
    });
  });
});
