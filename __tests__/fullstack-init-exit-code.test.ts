/**
 * The `lt fullstack` scaffolding commands must exit non-zero when they fail.
 *
 * A gluegun command signals failure by printing and returning. `return` alone
 * leaves the process at exit code 0, so every failure reported SUCCESS to
 * anything that checks `$?`:
 *
 *   lt fullstack init --name x --noConfirm && echo "ready"   # printed "ready"
 *
 * That is not theoretical. During the 2026-08 smoke-test run the install step
 * died on a native build script (`msgpackr-extract`), the spinner turned red —
 * and the command still exited 0. The half-built workspace was carried forward
 * and only noticed much later, by hand.
 *
 * **All THREE commands are covered, and that is the point.** `init` delegates to
 * `add-api` / `add-app` when it is run inside an existing workspace
 * (`init.ts`, the `cwdLayout.hasApi` / `hasApp` branches). A first version of
 * this guard covered only `init.ts`, so the contract silently depended on which
 * directory the user happened to be standing in: a fresh directory exited 1, the
 * same failure one level up exited 0. Reviewing the guard is what surfaced that —
 * hence the file list below rather than a single path.
 *
 * The rule enforced here: **every error path calls `failRun(toolbox)` before its
 * `return`.** Two kinds of return are legitimately silent, and neither is a
 * failure — a cancelled interactive prompt (the user pressed Escape) and a
 * `--help-json` request that has already printed what it was asked for.
 *
 * The test is structural rather than a string search on purpose. A source-string
 * assertion ("the file mentions failRun") stays green the moment someone adds a
 * new error path without it, which is exactly the regression worth catching.
 * Walking every `return;` means a NEW error path has to be classified — either it
 * marks the run failed, or it is added to the allowlist with a reason. Running
 * the real gluegun commands instead would require mocking git, the prompt
 * surface, the frontend helper and the package manager, which is why the
 * neighbouring `fullstack-init-*` specs assert against the source too.
 */
describe('Fullstack scaffolding exit codes', () => {
  // Lazy require to avoid colliding with the top-level `fs` / `path`
  // declarations in other test files (see the header comment in
  // `fullstack-init-next-frontend-branch.test.ts`).
  const nodeFs = require('fs');
  const nodePath = require('path');

  /**
   * The commands that scaffold, keyed by file, each with the guards whose
   * `return;` may leave the exit code at 0.
   *
   * `if (!name) {` / `if (!frontend) {` — the user declined to name the
   * workspace or pick a frontend, so nothing was attempted and nothing failed.
   * `if (toolbox.tools.helpJson(help)) {` — help was requested and printed; that
   * is the command succeeding at what it was asked to do.
   */
  const COMMANDS: { file: string; silentReturns: string[] }[] = [
    { file: 'init.ts', silentReturns: ['if (!name) {', 'if (!frontend) {'] },
    { file: 'add-api.ts', silentReturns: ['if (toolbox.tools.helpJson(help)) {'] },
    { file: 'add-app.ts', silentReturns: ['if (toolbox.tools.helpJson(help)) {'] },
  ];

  const sourceOf = (file: string): string =>
    nodeFs.readFileSync(nodePath.join(__dirname, '..', 'src', 'commands', 'fullstack', file), 'utf8');

  /** Every bare `return;` in `file`, with the trimmed source line above it. */
  const bareReturns = (file: string): { guard: string; line: number }[] => {
    const lines: string[] = sourceOf(file).split('\n');
    return lines
      .map((line, index) => ({ guard: (lines[index - 1] ?? '').trim(), index, line }))
      .filter((entry) => entry.line.trim() === 'return;')
      .map((entry) => ({ guard: entry.guard, line: entry.index + 1 }));
  };

  describe.each(COMMANDS)('$file', ({ file, silentReturns }) => {
    test('every error path marks the run failed before returning', () => {
      // The offenders are formatted INTO the compared value rather than passed as
      // a message: Jest's `expect` takes no second argument, and a bare
      // `toEqual([])` on line numbers prints a diff nobody can act on without
      // opening the file.
      const unmarked = bareReturns(file)
        .filter((entry) => entry.guard !== 'failRun(toolbox);')
        .filter((entry) => !silentReturns.includes(entry.guard))
        .map(
          (entry) =>
            `${file}:${entry.line} (after \`${entry.guard}\`) returns without failRun() — ` +
            `an error path must mark the run failed; a cancelled prompt or a printed ` +
            `--help-json belongs in this command's silentReturns list`,
        );

      expect(unmarked).toEqual([]);
    });

    test('the deliberately silent returns are still present and still silent', () => {
      // Guards the allowlist from the other direction: if a refactor renames these
      // conditions, the test above would silently accept whatever replaced them.
      const silent = bareReturns(file).filter((entry) => silentReturns.includes(entry.guard));
      expect(silent.map((entry) => entry.guard).sort()).toEqual([...silentReturns].sort());
    });

    test('has guarded error paths (the check cannot pass vacuously)', () => {
      const marked = bareReturns(file).filter((entry) => entry.guard === 'failRun(toolbox);');
      expect(marked.length).toBeGreaterThan(0);
    });

    test('uses the shared helper rather than a private copy', () => {
      // Three commands that hand off to each other must agree on the contract, or
      // the exit code depends on the caller's working directory — which is the bug
      // this file was extended to cover.
      expect(sourceOf(file)).toContain("from '../../lib/fail-run'");
    });
  });

  test('failRun sets process.exitCode and spares the interactive menu', () => {
    const helper: string = nodeFs.readFileSync(nodePath.join(__dirname, '..', 'src', 'lib', 'fail-run.ts'), 'utf8');
    // Comments stripped before the negative check: the doc block deliberately
    // NAMES `process.exit()` to explain why it is not used, and a naive scan of
    // the whole file fails on its own explanation.
    const code = helper.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // `process.exitCode`, not `process.exit()` — the latter can truncate the
    // spinner's own failure message, which is the one thing the operator needs.
    expect(code).toContain('process.exitCode = 1');
    expect(code).not.toMatch(/process\.exit\(/);

    // Inside the `lt` menu the command is one step of a longer session; failing
    // the whole menu run because one step errored is the same over-reach in reverse.
    expect(helper).toContain('fromGluegunMenu');
  });

  test('the real command exits 1 when the target directory already exists', () => {
    // The BEHAVIOURAL check the structural walk above only approximates.
    //
    // It matters that this exists: an extract-to-lib refactor turned all 15
    // correctly-guarded call sites into 15 reported violations, because the walk
    // asserts the SHAPE of the source rather than what the process does. A
    // behavioural test stays green through that, and goes red on the thing the
    // file's header actually claims — `lt fullstack init … && echo ready` must
    // not print "ready" after a failure.
    //
    // Cheap because this particular error path is reached before any git call,
    // network access, prompt or filesystem mutation: `bin/lt` runs the TypeScript
    // source through ts-node, so there is no build step either. ~2 s, no mocking.
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const os = require('os') as typeof import('os');

    const tmp = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'lt-exit-'));
    try {
      nodeFs.mkdirSync(nodePath.join(tmp, 'occupied'));
      const result = spawnSync(
        process.execPath,
        [nodePath.join(__dirname, '..', 'bin', 'lt'), 'fullstack', 'init', '--name', 'occupied', '--frontend', 'nuxt', '--noConfirm'],
        { cwd: tmp, encoding: 'utf8', timeout: 120_000 },
      );

      expect(result.status).toBe(1);
      // And it says why, rather than failing mutely.
      expect(`${result.stdout}${result.stderr}`).toMatch(/already a folder named/i);
    } finally {
      nodeFs.rmSync(tmp, { force: true, recursive: true });
    }
  }, 180_000);

  test('init delegates to add-api / add-app, so all three are covered here', () => {
    // Pins the reason the file list has three entries. If the delegation is ever
    // removed this test fails and the extra coverage can be reconsidered
    // deliberately, rather than quietly rotting.
    const init = sourceOf('init.ts');
    expect(init).toContain('addApiCommand.run');
    expect(init).toContain('addAppCommand.run');
    expect(COMMANDS.map((c) => c.file).sort()).toEqual(['add-api.ts', 'add-app.ts', 'init.ts']);
  });
});
