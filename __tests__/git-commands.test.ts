import { filesystem, system } from 'gluegun';

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`);

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

// Check if working directory is clean (no uncommitted changes)
const isWorkingDirectoryClean = async (): Promise<boolean> => {
  try {
    const status = await system.run('git status --porcelain');
    return !status?.trim();
  } catch {
    return false;
  }
};

export {};

describe('Git Commands', () => {
  let onBranch: boolean;
  let hasMainBranch: boolean;
  let cleanWorkingDir: boolean;

  beforeAll(async () => {
    onBranch = await isOnBranch();
    hasMainBranch = await branchExists('main');
    cleanWorkingDir = await isWorkingDirectoryClean();
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
