export {};

import { evalInNodeEsm, templateUrl } from './check-template-esm';

/**
 * `build-test-gate.mjs` is a concurrency primitive shipped verbatim into every
 * generated project. It had no test in this repo at all, while the repo that
 * consumes it kept one — so a regression here would have reached every project
 * with nothing in the CLI noticing.
 */
describe('build-test-gate.mjs', () => {
  const GATE = templateUrl('build-test-gate.mjs');
  /** Run `body` with `createBuildTestGate` in scope, in a real Node ESM process. */
  const inGate = <T>(body: string): T =>
    evalInNodeEsm<T>(`import { createBuildTestGate } from ${JSON.stringify(GATE)};\n${body}`);

  it('lets same-class steps overlap', () => {
    const result = inGate<{ activeCount: number; both: boolean }>(`
      const g = createBuildTestGate();
      let second = false;
      await g.acquire('build');
      g.acquire('build').then(() => { second = true; });
      await new Promise((r) => setImmediate(r));
      report({ activeCount: g.activeCount, both: second });
    `);
    expect(result.both).toBe(true);
    expect(result.activeCount).toBe(2);
  });

  it('excludes the opposite class while one is active', () => {
    const result = inGate<{ admitted: boolean; klass: string }>(`
      const g = createBuildTestGate();
      await g.acquire('build');
      let admitted = false;
      g.acquire('test').then(() => { admitted = true; });
      await new Promise((r) => setImmediate(r));
      report({ admitted, klass: g.activeClass });
    `);
    expect(result.admitted).toBe(false);
    expect(result.klass).toBe('build');
  });

  it('hands over to the waiting class once the active one drains', () => {
    const result = inGate<{ klass: string; order: string[] }>(`
      const g = createBuildTestGate();
      const order = [];
      await g.acquire('build'); order.push('build-in');
      g.acquire('test').then(() => order.push('test-in'));
      await new Promise((r) => setImmediate(r));
      g.release(); order.push('build-out');
      await new Promise((r) => setImmediate(r));
      report({ klass: g.activeClass, order });
    `);
    // The waiter must not start before the holder released.
    expect(result.order).toEqual(['build-in', 'build-out', 'test-in']);
    expect(result.klass).toBe('test');
  });

  it('admits every queued waiter of the taking-over class as one batch', () => {
    const result = inGate<{ activeCount: number; admitted: number }>(`
      const g = createBuildTestGate();
      await g.acquire('build');
      let admitted = 0;
      for (let i = 0; i < 3; i++) g.acquire('test').then(() => { admitted++; });
      await new Promise((r) => setImmediate(r));
      g.release();
      await new Promise((r) => setImmediate(r));
      report({ activeCount: g.activeCount, admitted });
    `);
    expect(result.admitted).toBe(3);
    expect(result.activeCount).toBe(3);
  });

  it('never deadlocks under Promise.all with mixed classes', () => {
    const result = inGate<{ done: number; finalClass: null | string; finalCount: number }>(`
      const g = createBuildTestGate();
      let done = 0;
      const work = (klass) => async () => {
        await g.acquire(klass);
        await new Promise((r) => setTimeout(r, 1));
        done++;
        g.release();
      };
      const classes = ['build','test','build','test','test','build','build','test'];
      await Promise.all(classes.map((k) => work(k)()));
      report({ done, finalClass: g.activeClass, finalCount: g.activeCount });
    `);
    expect(result.done).toBe(8);
    expect(result.finalCount).toBe(0);
    expect(result.finalClass).toBeNull();
  });

  it('ignores an unbalanced release instead of going negative', () => {
    // A negative counter silently BREAKS exclusion: with two holders and one
    // stray release, the counter reaches 0 while a holder is still running and
    // the opposite class gets admitted alongside it.
    const result = inGate<{ afterStray: number; leaked: boolean }>(`
      const g = createBuildTestGate();
      g.release();
      const afterStray = g.activeCount;
      await g.acquire('build');
      await g.acquire('build');
      g.release();
      let leaked = false;
      g.acquire('test').then(() => { leaked = true; });
      await new Promise((r) => setImmediate(r));
      report({ afterStray, leaked });
    `);
    expect(result.afterStray).toBe(0);
    expect(result.leaked).toBe(false);
  });

  it('is inert when steps never overlap (the --sequential case)', () => {
    const result = inGate<{ waits: number; finalCount: number }>(`
      const g = createBuildTestGate();
      let waits = 0;
      for (const klass of ['test','build','test','build']) {
        let immediate = false;
        const p = g.acquire(klass).then(() => { immediate = true; });
        await p;
        if (!immediate) waits++;
        g.release();
      }
      report({ waits, finalCount: g.activeCount });
    `);
    expect(result.waits).toBe(0);
    expect(result.finalCount).toBe(0);
  });
});
