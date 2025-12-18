const { filesystem, system } = require('gluegun');

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`);

describe('Git Commands', () => {
  describe('lt git update', () => {
    test('updates current branch', async () => {
      const output = await cli('git update');
      // Should run git fetch/pull
      expect(output).toBeDefined();
    });
  });

  describe('lt git update --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git update --dry-run');
      expect(output).toContain('DRY-RUN MODE');
      expect(output).toContain('Current branch:');
    });
  });

  describe('lt git create --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git create test-branch-dry-run --base main --dry-run');
      expect(output).toContain('DRY-RUN MODE');
      expect(output).toContain('Would create branch');
    });
  });

  describe('lt git force-pull --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git force-pull --dry-run');
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git reset --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git reset --dry-run');
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git undo --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git undo --dry-run');
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git rename --dry-run', () => {
    test('shows dry-run message or protected branch error', async () => {
      const output = await cli('git rename newname --dry-run');
      // On protected branches (main/dev/release), renaming is not allowed
      // On other branches, it shows DRY-RUN MODE
      expect(
        output.includes('DRY-RUN MODE') || output.includes('not allowed')
      ).toBe(true);
    });
  });

  describe('lt git squash --dry-run', () => {
    test('shows dry-run message or protected branch error', async () => {
      const output = await cli('git squash --dry-run');
      // On protected branches (main/dev/release), squashing is not allowed
      // On other branches, it shows DRY-RUN MODE
      expect(
        output.includes('DRY-RUN MODE') || output.includes('not allowed')
      ).toBe(true);
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
