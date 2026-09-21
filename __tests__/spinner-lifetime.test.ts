/**
 * A progress spinner that is never stopped does not just look untidy — it keeps
 * the process alive.
 *
 * gluegun's `spin()` is ora 4.0.2 with `discardStdin: true`. Starting one calls
 * `stdin.setRawMode(true)`, `stdin.resume()` and `setInterval(render)`. The
 * interval and the resumed stdin hold the Node event loop open, so a command that
 * returns without stopping its spinner **never exits**, and leaves the terminal in
 * raw mode. `failRun` deliberately sets `process.exitCode` rather than calling
 * `process.exit()` (so the failure message is not truncated), which makes "the
 * event loop drains" a precondition, not a nicety.
 *
 * The bug this guards against was live in `fullstack/init.ts`: `ngBaseSpinner`
 * started at the top of the command and had exactly one stop, *inside* an
 * `if (isDirectory(projects/app))`. Three error paths returned before it and a
 * fourth fell off the end of the command entirely — no message, no failing exit
 * code, exit 0, and a process that did not come back.
 *
 * ## Scope, and why it is not the whole repo
 *
 * Deliberately the same three files as `fullstack-init-exit-code.test.ts`: the
 * scaffolding commands that hand off to each other. Running the analyser over all
 * of `src/` reports 15 more findings in 7 files, and they are NOT all bugs —
 * `commands/doctor.ts` stops its spinner either inside a `for` loop or in a
 * following `if (!hasConfig)`, which is correct but needs value tracking to prove.
 * A guard that flags correct code gets switched off, so the untriaged files stay
 * out until someone looks at them one by one. `commands/git/squash.ts:146` was
 * checked by hand and IS a real leak — that one is a follow-up, not a false alarm.
 */
import { findSpinnerLeaks } from '../src/lib/spinner-lifetime';

describe('spinner lifetimes in the scaffolding commands', () => {
  const nodeFs = require('fs');
  const nodePath = require('path');

  const COMMANDS = ['init.ts', 'add-api.ts', 'add-app.ts'];

  const sourceOf = (file: string): string =>
    nodeFs.readFileSync(nodePath.join(__dirname, '..', 'src', 'commands', 'fullstack', file), 'utf8');

  test.each(COMMANDS)('%s stops every spinner it starts, on every path', (file) => {
    // Formatted into the compared value rather than passed as a message: Jest's
    // `expect` takes no second argument, and a bare `toEqual([])` on line numbers
    // prints a diff nobody can act on without opening the file.
    const leaks = findSpinnerLeaks(sourceOf(file), file).map(
      (leak) =>
        `${file}:${leak.line} ${leak.spinner} (${leak.reason}) — a spinner left running holds ` +
        `the event loop open, so the command never exits and the terminal stays in raw mode`,
    );

    expect(leaks).toEqual([]);
  });

  test('the guard is not vacuous — it still sees the spinners', () => {
    // Without this, deleting every `spin()` call (or breaking the detector) would
    // read as a pass.
    const starts = COMMANDS.map((file) => (sourceOf(file).match(/=\s*spin\(/g) || []).length);
    expect(starts.every((count) => count > 0)).toBe(true);
    expect(starts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10);
  });
});

describe('findSpinnerLeaks', () => {
  const wrap = (body: string): string => `const run = async () => {\n${body}\n};`;

  it('reports a return that skips the stop', () => {
    const source = wrap(`
      const s = spin('x');
      if (bad) {
        error('nope');
        return;
      }
      s.succeed('done');
    `);
    expect(findSpinnerLeaks(source)).toEqual([expect.objectContaining({ reason: 'return-without-stop', spinner: 's' })]);
  });

  it('reports falling off the end — the silent, exit-code-0 case', () => {
    // The shape that was live in init.ts: the only stop sits inside an `if` with
    // no `else`, so the command can reach the end with the spinner still running.
    const source = wrap(`
      const s = spin('x');
      if (ready) {
        s.succeed('done');
        doTheWork();
      }
    `);
    expect(findSpinnerLeaks(source)).toEqual([expect.objectContaining({ reason: 'falls-through', spinner: 's' })]);
  });

  it('accepts an if/else that stops on both sides', () => {
    const source = wrap(`
      const s = spin('x');
      if (ready) {
        s.succeed('done');
      } else {
        s.fail('not ready');
      }
    `);
    expect(findSpinnerLeaks(source)).toEqual([]);
  });

  it('accepts try/catch that stops in both arms, and a stopping finally', () => {
    const both = wrap(`
      const s = spin('x');
      try {
        await work();
        s.succeed('done');
      } catch (err) {
        s.fail('failed');
      }
    `);
    const viaFinally = wrap(`
      const s = spin('x');
      try {
        await work();
      } finally {
        s.stop();
      }
    `);
    expect(findSpinnerLeaks(both)).toEqual([]);
    expect(findSpinnerLeaks(viaFinally)).toEqual([]);
  });

  it('accepts a stop that dominates a later return', () => {
    const source = wrap(`
      const s = spin('x');
      s.succeed('done');
      if (bad) {
        return;
      }
    `);
    expect(findSpinnerLeaks(source)).toEqual([]);
  });

  it('ignores a return inside a nested callback', () => {
    // That return leaves the callback, not the command, so it cannot skip the stop.
    const source = wrap(`
      const s = spin('x');
      items.forEach((item) => {
        if (!item) {
          return;
        }
      });
      s.succeed('done');
    `);
    expect(findSpinnerLeaks(source)).toEqual([]);
  });

  it('treats `return spinner` as handing ownership to the caller', () => {
    // `logger.ts#spin` is a factory: it starts a spinner and returns it, and the
    // caller stops it. Flagging that was a false positive this check had to lose.
    const source = `
      function make(text) {
        const spinner = this.print.spin(text);
        log('starting');
        return spinner;
      }
    `;
    expect(findSpinnerLeaks(source)).toEqual([]);
  });

  it('recognises a spinner created through a property call', () => {
    // `toolbox.print.spin(...)`, not the destructured `spin(...)` — both shapes
    // occur in the codebase. This fixture leaks twice over (it returns early AND
    // never stops), so assert on the spinner rather than on one reason.
    const source = wrap(`
      const s = toolbox.print.spin('x');
      return;
    `);
    const leaks = findSpinnerLeaks(source);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.map((leak) => leak.spinner)).toEqual(leaks.map(() => 's'));
  });

  it('does not claim to prove what it cannot — a loop-plus-flag stop is reported', () => {
    // KNOWN LIMITATION, pinned on purpose. `commands/doctor.ts` has exactly this
    // shape and is CORRECT: the loop stops the spinner and sets the flag, and the
    // `if (!flag)` stops it otherwise. Proving that needs value tracking. The
    // analyser is conservative instead, which is why its scope is an explicit file
    // list rather than all of `src/`. If someone teaches it to see through this,
    // this test should flip — that is the signal to widen the scope.
    const source = wrap(`
      const s = spin('x');
      let found = false;
      for (const file of files) {
        if (exists(file)) {
          found = true;
          s.succeed('found');
          break;
        }
      }
      if (!found) {
        s.info('nothing');
      }
    `);
    expect(findSpinnerLeaks(source)).toEqual([expect.objectContaining({ reason: 'falls-through' })]);
  });
});
