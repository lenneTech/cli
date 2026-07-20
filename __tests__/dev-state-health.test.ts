import {
  classifyComponentHealth,
  type ComponentHealth,
  partitionComponentStates,
  STARTUP_GRACE_MS,
  summarizeStackHealth,
} from '../src/lib/dev-state';

/**
 * Regression cover for the `starting` liveness state added to the `lt dev` health
 * model — the grace-window classification and its guard branches, plus the two pure
 * stack-aggregation helpers that `lt dev status` renders.
 *
 * The BASE running/crashed/dead contract of `classifyComponentHealth` is the single
 * source of truth in `dev-state.test.ts`; this file covers ONLY the NEW `starting`
 * behavior so the two files cannot drift.
 */
describe('classifyComponentHealth — startup grace window', () => {
  const alivePid = process.pid; // the test process is definitely alive

  it('is `starting` when the port is not bound yet but within the startup grace window', () => {
    expect(classifyComponentHealth({ pid: alivePid, portBound: false, startedAt: new Date().toISOString() })).toBe(
      'starting',
    );
    // Just inside the window.
    const almost = new Date(Date.now() - (STARTUP_GRACE_MS - 5_000)).toISOString();
    expect(classifyComponentHealth({ pid: alivePid, portBound: false, startedAt: almost })).toBe('starting');
  });

  it('is `running` even inside the grace window once the port is bound (port-bound wins)', () => {
    expect(classifyComponentHealth({ pid: alivePid, portBound: true, startedAt: new Date().toISOString() })).toBe(
      'running',
    );
  });

  it('is `crashed` once the grace window has elapsed with the port still free', () => {
    const old = new Date(Date.now() - (STARTUP_GRACE_MS + 30_000)).toISOString();
    expect(classifyComponentHealth({ pid: alivePid, portBound: false, startedAt: old })).toBe('crashed');
  });

  it('leaves the grace window opt-in: no startedAt → `crashed` (unchanged base behavior)', () => {
    expect(classifyComponentHealth({ pid: alivePid, portBound: false })).toBe('crashed');
  });

  it('respects a custom startupGraceMs override', () => {
    const startedAt = new Date(Date.now() - 2_000).toISOString();
    expect(classifyComponentHealth({ pid: alivePid, portBound: false, startedAt, startupGraceMs: 1_000 })).toBe(
      'crashed',
    );
    expect(classifyComponentHealth({ pid: alivePid, portBound: false, startedAt, startupGraceMs: 10_000 })).toBe(
      'starting',
    );
  });

  // ── Guard branches — the implementation explicitly guards these
  //    (`Number.isFinite(ageMs) && ageMs >= 0`); pin them so a refactor can't
  //    silently drop a guard and let a corrupt/skewed timestamp read as `starting`.
  it('treats an unparseable startedAt as `crashed` (Number.isFinite guard)', () => {
    expect(classifyComponentHealth({ pid: alivePid, portBound: false, startedAt: 'not-a-date' })).toBe('crashed');
  });

  it('treats a future startedAt (clock skew / NTP jump) as `crashed`, not `starting` (ageMs >= 0 guard)', () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    expect(classifyComponentHealth({ pid: alivePid, portBound: false, startedAt: future })).toBe('crashed');
  });

  it('pins the exact grace boundary with a fixed clock (age === grace → crashed, one ms less → starting)', () => {
    jest.useFakeTimers();
    try {
      const now = 1_700_000_000_000; // fixed epoch — deterministic ageMs
      jest.setSystemTime(now);
      const grace = STARTUP_GRACE_MS;
      // Exactly at the boundary: ageMs === grace → NOT `< grace` → crashed.
      expect(
        classifyComponentHealth({ pid: alivePid, portBound: false, startedAt: new Date(now - grace).toISOString() }),
      ).toBe('crashed');
      // One ms inside the window → starting.
      expect(
        classifyComponentHealth({
          pid: alivePid,
          portBound: false,
          startedAt: new Date(now - grace + 1).toISOString(),
        }),
      ).toBe('starting');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('summarizeStackHealth', () => {
  const h = (state: ComponentHealth): ComponentHealth => state;

  it('is `stopped` for an empty component list', () => {
    expect(summarizeStackHealth([])).toBe('stopped');
  });

  it('is `running` only when every component is running', () => {
    expect(summarizeStackHealth([h('running'), h('running')])).toBe('running');
  });

  it('is `degraded` when some run and some do not (mixed up/down)', () => {
    expect(summarizeStackHealth([h('running'), h('crashed')])).toBe('degraded');
    expect(summarizeStackHealth([h('running'), h('starting')])).toBe('degraded');
    expect(summarizeStackHealth([h('running'), h('dead')])).toBe('degraded');
  });

  it('is `starting` when none run yet but at least one is booting', () => {
    expect(summarizeStackHealth([h('starting'), h('dead')])).toBe('starting');
    expect(summarizeStackHealth([h('starting'), h('crashed')])).toBe('starting');
  });

  it('is `crashed` when none run or boot but at least one crashed', () => {
    expect(summarizeStackHealth([h('crashed'), h('dead')])).toBe('crashed');
  });

  it('is `stopped` when every component is dead', () => {
    expect(summarizeStackHealth([h('dead'), h('dead')])).toBe('stopped');
  });
});

describe('partitionComponentStates', () => {
  it('excludes a `starting` component from `down` (never prompt a restart of a booting stack)', () => {
    const { down, starting } = partitionComponentStates([
      { health: 'starting', name: 'api', present: true },
      { health: 'crashed', name: 'app', present: true },
    ]);
    expect(starting).toEqual(['api']);
    expect(down).toEqual(['app']);
  });

  it('lists crashed and dead present components as down', () => {
    const { down, starting } = partitionComponentStates([
      { health: 'crashed', name: 'api', present: true },
      { health: 'dead', name: 'app', present: true },
    ]);
    expect(starting).toEqual([]);
    expect(down).toEqual(['api', 'app']);
  });

  it('ignores components that are not present', () => {
    const { down, starting } = partitionComponentStates([
      { health: 'crashed', name: 'api', present: false },
      { health: 'starting', name: 'app', present: false },
    ]);
    expect(down).toEqual([]);
    expect(starting).toEqual([]);
  });

  it('treats a running component as neither down nor starting', () => {
    const { down, starting } = partitionComponentStates([{ health: 'running', name: 'api', present: true }]);
    expect(down).toEqual([]);
    expect(starting).toEqual([]);
  });
});
