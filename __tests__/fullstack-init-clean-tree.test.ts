/**
 * A freshly generated workspace has to start with a clean working tree.
 *
 * `lt fullstack init` used to run its best-effort `lt dev init` (`runMigrate`) AFTER the
 * initial commit. That step writes the URL block into the three CLAUDE.md files and the
 * env bridge into `projects/app/playwright.config.ts`, so every new project began with four
 * modified files nobody had touched. Measured 2026-11-03 on macOS (4 files, 86 lines) and on
 * Windows, where a `/lt-dev:ticket-cycle` run then stopped to ask whose changes they were.
 *
 * Structural, like the neighbouring `fullstack-init-*` specs: running the real command needs
 * network clones and a package install. The end-to-end check (init, then `git status
 * --porcelain` empty, a second `lt dev init` still empty, `format:check` green) is in the PR.
 */
describe('lt fullstack init leaves a clean working tree', () => {
  const nodeFs = require('fs');
  const nodePath = require('path');
  const source: string = nodeFs.readFileSync(
    nodePath.join(__dirname, '..', 'src', 'commands', 'fullstack', 'init.ts'),
    'utf8',
  );

  it('runs lt dev init before the initial commit', () => {
    const migrate = source.indexOf('runMigrate({ layout })');
    const commit = source.indexOf("['commit', '-m', 'Initial commit']");
    expect(migrate).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(-1);
    expect(migrate).toBeLessThan(commit);
  });

  it('runs it after the post-install format pass, which it does not need to repeat', () => {
    // The patched files were measured format:check-clean, so the order format -> lt dev init
    // -> commit keeps the commit identical to what a later `lt dev init` would produce.
    expect(source.indexOf('runMigrate({ layout })')).toBeGreaterThan(source.lastIndexOf('formatProject('));
  });
});
