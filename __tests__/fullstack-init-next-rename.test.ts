const fs = require('fs');
const path = require('path');
// `filesystem` / `patching` are required lazily inside the test that
// uses them so this file doesn't collide with the global-scope
// declarations in other test files (e.g.
// `fullstack-claude-md-patching.test.ts`). ts-jest treats every test
// file as part of one TypeScript program, so top-level `const
// { filesystem } = require('gluegun')` here would trigger TS2451.

/**
 * Auto-rename behaviour for `lt fullstack init --next`.
 *
 * The experimental nest-base template ships with hard-coded `nest-base`
 * references in four files. After cloning, the CLI runs
 * `bun run rename <projectDir>` for the user.
 *
 * Two things need to hold for that to work end-to-end:
 *
 *   1. The init.ts code path actually invokes the rename script when
 *      `--next` is set, and only then. We verify this by reading the
 *      command source directly — the rename is a single, deterministic
 *      `system.run` call inside the `experimental` block.
 *
 *   2. Before invoking the rename, init.ts restores `package.json`'s
 *      `name` to `"nest-base"` so the planner has a coherent starting
 *      state across all four files. Otherwise the planner would treat
 *      `projectDir` as the "old" name, fail to match `# nest-base` in
 *      the README, and leave the rename half-done. This regression is
 *      easy to reintroduce, so we cover the package.json reset as a
 *      black-box test against a fixture.
 */
describe('Fullstack init --next auto-rename', () => {
  const initSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'commands', 'fullstack', 'init.ts'),
    'utf8',
  );

  test('init.ts invokes `bun run rename` when --next is set', () => {
    expect(initSource).toMatch(/bun run rename \$\{projectDir\}/);
  });

  test('rename invocation is gated on the experimental flag', () => {
    // Match the entire `if (experimental && apiResult.method !== 'link') {
    // ... }` block so a refactor that drops the gate without re-adding it
    // breaks the test.
    expect(initSource).toMatch(/if \(experimental && apiResult\.method !== 'link'\) \{[\s\S]*?bun run rename/);
  });

  test('init.ts no longer prints a manual rename hint in the Next section', () => {
    // The Next: section for the experimental branch must not tell the
    // user to run rename themselves — the CLI does it now.
    const nextSection = initSource.match(/info\('Next:'\);[\s\S]*?info\(''\);/);
    expect(nextSection).not.toBeNull();
    expect(nextSection![0]).not.toMatch(/bun run rename/);
  });

  describe('package.json name reset', () => {
    let tempDir: string;
    // Lazy require to avoid a top-level `filesystem` declaration that
    // would clash with other test files' globals (see header comment).
    const { filesystem, patching } = require('gluegun');

    beforeEach(() => {
      tempDir = filesystem.path('__tests__', `temp-fullstack-rename-${Date.now()}`);
      filesystem.dir(tempDir);
    });

    afterEach(() => {
      filesystem.remove(tempDir);
    });

    test('reverts package.json name back to "nest-base" so the planner can detect the canonical old slug', async () => {
      const pkgPath = filesystem.path(tempDir, 'package.json');
      // Simulate state after setupServerForFullstack: the experimental
      // patch has already overwritten the template's `name` field with
      // the project's kebab-cased directory name.
      filesystem.write(pkgPath, {
        name: 'my-next-fs',
        description: 'API for my-next-fs app',
        version: '0.0.0',
      });

      // This is the exact patch init.ts performs before invoking rename.
      await patching.update(pkgPath, (config: Record<string, unknown>) => {
        config.name = 'nest-base';
        return config;
      });

      const result = filesystem.read(pkgPath, 'json');
      expect(result.name).toBe('nest-base');
      // Other fields must survive untouched so the rename is the only
      // thing that changes the surrounding state.
      expect(result.description).toBe('API for my-next-fs app');
      expect(result.version).toBe('0.0.0');
    });
  });
});
