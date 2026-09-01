/**
 * A workspace conflict is only useful if somebody sees it.
 *
 * `finalizeWorkspaceRoot` returns disagreements it refuses to resolve silently:
 * two sources pinning one package differently, an audit suppression that
 * hoisting just widened to the whole workspace, or — in the incremental flow —
 * a value this run overwrites that an earlier run hoisted from the sibling
 * sub-project. None of that changes the exit code, so the printout IS the
 * feature. Drop it from one command and the workspace still assembles, the tests
 * still pass, and a version split between api and app ships in silence.
 *
 * **All THREE commands are covered, for the same reason the exit-code guard
 * covers all three:** `init` delegates to `add-api` / `add-app` when run inside
 * an existing workspace, so covering only `init.ts` would make the warning
 * depend on which directory the user was standing in.
 *
 * The assertions are structural rather than behavioural because running the real
 * commands would mean mocking git, the prompts, the frontend helper and the
 * package manager — the same trade-off the neighbouring `fullstack-init-*` specs
 * make. What the structure has to show is narrow and hard to satisfy by
 * accident: the return value is destructured, and it is handed to the shared
 * reporter rather than re-implemented per command.
 */
describe('Workspace conflicts are surfaced by every scaffolding command', () => {
  // Lazy require to avoid colliding with top-level `fs` / `path` declarations in
  // sibling test files (see `fullstack-init-next-frontend-branch.test.ts`).
  const nodeFs = require('fs');
  const nodePath = require('path');

  const COMMANDS = ['init.ts', 'add-api.ts', 'add-app.ts'];

  const sourceOf = (file: string): string =>
    nodeFs.readFileSync(nodePath.join(__dirname, '..', 'src', 'commands', 'fullstack', file), 'utf8');

  for (const file of COMMANDS) {
    describe(file, () => {
      const source = sourceOf(file);

      it('captures the conflicts returned by finalizeWorkspaceRoot', () => {
        // Not `finalizeWorkspaceRoot(...)` bare: discarding the return value is
        // precisely the regression this guards against.
        expect(source).toMatch(/const\s*\{\s*conflicts\s*\}\s*=\s*finalizeWorkspaceRoot\(/);
      });

      it('reports them through the shared reporter', () => {
        expect(source).toContain('reportWorkspaceConflicts(conflicts');
        expect(source).toContain("from '../../lib/workspace-integration'");
      });

      it('repeats them after the install output that would otherwise bury them', () => {
        // The first call sits directly above `pnpm install`, whose several
        // hundred lines scroll the warning off screen. The second lands in the
        // closing block, next to "Next:".
        const occurrences = source.split('reportWorkspaceConflicts(conflicts').length - 1;
        expect(occurrences).toBeGreaterThanOrEqual(2);
      });

      it('does not hand-roll the printing loop', () => {
        // Three hand-copied loops were the previous shape; the wording drifted
        // between them and nothing kept them in step.
        expect(source).not.toMatch(/for\s*\(const conflict of conflicts\)/);
      });
    });
  }
});
