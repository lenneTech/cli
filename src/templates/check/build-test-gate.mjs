/**
 * Cross-group mutual exclusion between CPU-heavy steps and contention-sensitive
 * test suites (DEV-2524, cause 2).
 *
 * The root check wrapper (scripts/check.mjs) runs each workspace project's step
 * chain concurrently by default. The api group's `test` step is the API e2e
 * suite, whose Better-Auth session validation is sensitive to CPU contention:
 * it tips into intermittent 401/500 the moment another group saturates the
 * machine — most reliably the app group's `nuxt build`. Measured in DEV-2524:
 * the same commit was red under the parallel run and green (2418/2418) under
 * `--sequential`. This gate guarantees a heavy step and a sensitive test step
 * never run at the same time, while:
 *   - same-class steps may still overlap (two builds, or two test suites)
 *     → the parallel design is preserved elsewhere;
 *   - every other step kind (format, lint, server-start, …) never touches the
 *     gate at all and stays fully parallel.
 *
 * Which steps belong to which class is `gateClass()` in check.mjs, not this
 * file: the gate is a generic two-class lock and does not know what a "build"
 * is. Note that the classes are named "build" and "test" only because those are
 * the labels the caller passes; the lock treats them as two opaque, mutually
 * exclusive classes.
 *
 * It is a two-class fair lock: whichever class is active admits every waiter of
 * that class; the other class waits until the active class fully drains, then
 * takes over as a batch. Handover is FIFO between the two classes, so neither
 * can starve the other.
 *
 * Starvation-freedom is workload-bounded, not unconditional: an arriving acquire
 * of the ACTIVE class barges ahead of an already-queued opposite-class waiter, so
 * an unbounded stream of same-class arrivals could in theory starve the other
 * class. That cannot happen here — the check wrapper issues FINITELY MANY gated
 * steps per group, so the active class always drains and the queued batch is then
 * admitted. (Do not restate this as "one test then one build per group": the root
 * group has a `test` and no build at all, and a chain's shape is the project's to
 * choose. Finiteness is what the argument needs, and finiteness is what holds.)
 */
export function createBuildTestGate() {
  let activeClass = null; // 'test' | 'build' | null
  let activeCount = 0;
  const queue = []; // FIFO of { klass, resolve }

  function admit(klass, resolve) {
    activeClass = klass;
    activeCount += 1;
    resolve();
  }

  function acquire(klass) {
    return new Promise((resolve) => {
      if (activeClass === null || activeClass === klass) {
        admit(klass, resolve);
      } else {
        queue.push({ klass, resolve });
      }
    });
  }

  function release() {
    // Guard against an unbalanced release. Without it the counter goes negative
    // and the lock stops excluding: with two holders and one stray release,
    // `activeCount` reaches 0 while a holder is still running, so the opposite
    // class is admitted alongside it — silently, and precisely when the machine
    // is busiest. No current caller can double-release (runGroup acquires and
    // releases exactly once per gated step), but this is shipped into every
    // generated project and there are two release sites per acquire.
    if (activeCount <= 0) return;

    activeCount -= 1;
    if (activeCount > 0) return;

    activeClass = null;
    if (queue.length === 0) return;

    // Active class fully drained with waiters pending: hand over to the class of
    // the oldest waiter, admitting every queued waiter of that class as a batch.
    //
    // Via the public API the queue only ever holds a SINGLE class at a time (a
    // same-class acquire is admitted immediately and never queues, so only the
    // opposite class waits while one class is active). The `carried` re-queue is
    // therefore always empty in practice — kept as a defensive guard so the
    // handover stays correct if the admission rule ever changes.
    const nextClass = queue[0].klass;
    const carried = [];
    for (const waiter of queue) {
      if (waiter.klass === nextClass) {
        admit(waiter.klass, waiter.resolve);
      } else {
        carried.push(waiter);
      }
    }
    queue.length = 0;
    queue.push(...carried);
  }

  return {
    acquire,
    release,
    // Read-only accessors, exposed for assertions / telemetry only.
    get activeClass() {
      return activeClass;
    },
    get activeCount() {
      return activeCount;
    },
  };
}
