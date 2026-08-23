export {};

import { evalInNodeEsm, templateUrl } from './check-template-esm';

/**
 * Guard for the pure helpers of `src/templates/check/check.mjs`.
 *
 * The module exports them "so a guard can assert exactly that" — but no guard
 * existed in this repo, and the invariant it named was false. The CLI is the
 * DISTRIBUTION point for this template: a regression here reaches every project
 * scaffolded or migrated by `lt`, so it has to be caught here, not downstream.
 */
describe('check.mjs template', () => {
  const CHECK = templateUrl('check.mjs');
  const inCheck = <T>(body: string): T =>
    evalInNodeEsm<T>(`import * as m from ${JSON.stringify(CHECK)};\n${body}`);

  it('does not run the check when imported', () => {
    // A `main()` that fires on import would make every one of these assertions
    // launch a full check run — and, worse, an importing guard in a generated
    // project would too.
    const result = inCheck<{ exports: string[] }>(`
      report({ exports: Object.keys(m).sort() });
    `);
    expect(result.exports).toEqual(
      expect.arrayContaining(['PM_INVOCATION', 'buildGroups', 'gateClass', 'pinCheckBuildDir', 'resolveCliEntry']),
    );
  });

  describe('build-dir pinning', () => {
    it('pins every package-manager call that carries no pin of its own', () => {
      const result = inCheck<Record<string, string>>(`
        const cmds = [
          'pnpm install --frozen-lockfile',
          'pnpm i',
          'npm ci',
          'pnpm audit --audit-level=low',
          'npm audit',
          'pnpm run audit:ci',
        ];
        report(Object.fromEntries(cmds.map((c) => [c, m.pinCheckBuildDir(c)])));
      `);
      for (const [cmd, pinned] of Object.entries(result)) {
        expect(pinned).toBe(`NUXT_BUILD_DIR=.nuxt-check ${cmd}`);
      }
    });

    it('never overrides a pin the command already carries — including the cross-env form', () => {
      // `cross-env NUXT_BUILD_DIR=… pnpm …` is the shape the nuxt starter ships.
      // A `^`-anchored check does not see it and prefixes a second, conflicting
      // assignment.
      const result = inCheck<Record<string, string>>(`
        const cmds = [
          'NUXT_BUILD_DIR=.custom pnpm install',
          'cross-env NUXT_BUILD_DIR=.nuxt-check pnpm install --frozen-lockfile',
          'cross-env NUXT_BUILD_DIR=.custom pnpm audit',
        ];
        report(Object.fromEntries(cmds.map((c) => [c, m.pinCheckBuildDir(c)])));
      `);
      for (const [cmd, pinned] of Object.entries(result)) {
        expect(pinned).toBe(cmd);
      }
    });

    it('leaves commands alone that are not package-manager calls', () => {
      const result = inCheck<Record<string, string>>(`
        const cmds = ['pnpm run build', 'bash scripts/check-server-start.sh', 'tsc -p .'];
        report(Object.fromEntries(cmds.map((c) => [c, m.pinCheckBuildDir(c)])));
      `);
      for (const [cmd, pinned] of Object.entries(result)) {
        expect(pinned).toBe(cmd);
      }
    });

    it('is idempotent', () => {
      const result = inCheck<{ once: string; twice: string }>(`
        const once = m.pinCheckBuildDir('pnpm install');
        report({ once, twice: m.pinCheckBuildDir(once) });
      `);
      expect(result.twice).toBe(result.once);
    });
  });

  describe('hoist ⇄ pin invariant', () => {
    it('pins EVERY command it hoists — the two predicates cannot diverge', () => {
      // The failure this prevents is silent: a command gets hoisted (so it is no
      // longer an ordinary step) while the pin declines to apply, and the hoisted
      // command then runs `postinstall: nuxt prepare` against a dev server's
      // `.nuxt`. Asserted over the hoisting logic itself (buildGroups), not over
      // a hand-picked sample of spellings.
      const result = inCheck<{ audit: string; install: string; unpinned: string[] }[]>(`
        const chains = [
          'pnpm install --frozen-lockfile && pnpm audit && pnpm run build',
          'pnpm i && pnpm run lint',
          'npm ci && npm audit --audit-level=moderate && npm run build',
          'yarn npm audit --all && yarn run build',
          'cross-env NUXT_BUILD_DIR=.nuxt-check pnpm install --frozen-lockfile && pnpm test',
        ];
        report(chains.map((check) => {
          const r = m.buildGroups([{ check, dir: '.', name: 'x', rel: '.' }]);
          const hoisted = [r.auditCmd, r.installCmd].filter(Boolean);
          return {
            audit: r.auditCmd,
            install: r.installCmd,
            unpinned: hoisted.filter((c) => !/(^|\\s)NUXT_BUILD_DIR=/.test(c)),
          };
        }));
      `);
      for (const row of result) {
        expect(row.unpinned).toEqual([]);
      }
      // …and the hoist actually happened, so the assertion above is not vacuous.
      expect(result.filter((r) => r.install).length).toBeGreaterThan(0);
      expect(result.filter((r) => r.audit).length).toBeGreaterThan(0);
    });

    it('does not hoist a project script that merely has "audit" in its name', () => {
      // `runAudit` appends ` --json` to whatever was hoisted. A script that does
      // not accept that flag exits non-zero, and the check fails on an argument
      // the wrapper invented for it.
      const result = inCheck<{ audit: null | string; labels: string[] }>(`
        const r = m.buildGroups([{ check: 'pnpm run check:audit-log-schema && pnpm run build', dir: '.', name: 'x', rel: '.' }]);
        report({ audit: r.auditCmd, labels: r.groups[0].steps.map((s) => s.label) });
      `);
      expect(result.audit).toBeNull();
      expect(result.labels).toContain('build');
      expect(result.labels.length).toBe(2);
    });
  });

  describe('gate classification', () => {
    it('gates the CPU-heavy steps, including typecheck', () => {
      // `typecheck` runs vue-tsc/tsc and contains neither "build" nor "tsc" as a
      // substring, so it used to classify as `other` and run fully concurrent
      // with the API e2e suite — the gate paid its cost and left the second
      // heaviest load in the chain unserialised.
      // Keyed by the ORIGINAL command: `toFixCommand` rewrites some of them on
      // the way into the step list (`lint` becomes `lint:fix`), so `step.cmd` is
      // not what the chain said.
      const result = inCheck<{ klass: null | string; raw: string }[]>(`
        const raws = [
          'pnpm run format', 'pnpm run lint', 'pnpm test',
          'pnpm run build:check', 'pnpm run typecheck', 'pnpm run typecheck:tests',
          'bash scripts/check-server-start.sh',
        ];
        const r = m.buildGroups([{ check: raws.join(' && '), dir: '.', name: 'x', rel: '.' }]);
        report(r.groups[0].steps.map((s, i) => ({ klass: m.gateClass(s) ?? null, raw: raws[i] })));
      `);
      const klassOf = (raw: string): null | string | undefined => result.find((r) => r.raw === raw)?.klass;
      expect(result).toHaveLength(7); // no step silently dropped
      expect(klassOf('pnpm run typecheck')).toBe('build');
      expect(klassOf('pnpm run typecheck:tests')).toBe('build');
      expect(klassOf('pnpm run build:check')).toBe('build');
      expect(klassOf('pnpm test')).toBe('test');
      expect(klassOf('pnpm run format')).toBeNull();
      expect(klassOf('pnpm run lint')).toBeNull();
      expect(klassOf('bash scripts/check-server-start.sh')).toBeNull();
    });

    it('lets an explicitly unit-only run through the gate', () => {
      const result = inCheck<null | string>(`
        const r = m.buildGroups([{ check: 'pnpm run test:unit', dir: '.', name: 'x', rel: '.' }]);
        report(m.gateClass(r.groups[0].steps[0]));
      `);
      expect(result).toBeNull();
    });

    it('treats a bare test step as sensitive — the safe direction', () => {
      // A bare `pnpm test` resolves to the API e2e suite in the starters. Too
      // wide costs wall-clock; too narrow costs the flaky suite this gate exists
      // to fix, so the ambiguous case must land on "sensitive".
      const result = inCheck<null | string>(`
        const r = m.buildGroups([{ check: 'pnpm test', dir: '.', name: 'x', rel: '.' }]);
        report(m.gateClass(r.groups[0].steps[0]));
      `);
      expect(result).toBe('test');
    });
  });

  describe('audit accounting', () => {
    it('claims nothing is suppressed when the report has no advisories list', () => {
      // npm 7+ emits `auditReportVersion: 2` with a `vulnerabilities` map and no
      // `advisories` key. Deriving there made `unlisted === total`, so a real,
      // unassessed critical rendered dimmed and labelled as suppressed.
      const result = inCheck<number>(`
        report(m.countUnlisted({
          auditReportVersion: 2,
          vulnerabilities: { pkg: { severity: 'critical' } },
          metadata: { vulnerabilities: { critical: 1, high: 0, moderate: 0, low: 0, info: 0 } },
        }));
      `);
      expect(result).toBe(0);
    });

    it('counts what metadata has but advisories does not', () => {
      const result = inCheck<number>(`
        report(m.countUnlisted({
          advisories: {},
          metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0, info: 0 } },
        }));
      `);
      expect(result).toBe(1);
    });

    it('counts nothing when every finding is listed', () => {
      const result = inCheck<number>(`
        report(m.countUnlisted({
          advisories: { '1': { severity: 'high' } },
          metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0, info: 0 } },
        }));
      `);
      expect(result).toBe(0);
    });
  });

  describe('recursive-check detection', () => {
    it('recognises every fan-out spelling, not just `pnpm -r run check`', () => {
      // A surviving fan-out runs every member a SECOND time — concurrently with
      // the wrapper's own member groups, because the root group runs under the
      // same Promise.all. That means two installs against one node_modules and
      // two e2e suites on one database.
      const result = inCheck<Record<string, boolean>>(`
        const cmds = [
          'pnpm -r --parallel run check', 'pnpm -r check', 'pnpm --recursive check',
          'pnpm --filter ./projects/* run check', 'pnpm --filter=./projects/* run check',
          'npm run check --workspaces', 'yarn workspaces foreach -A run check',
          'turbo run check', 'lerna run check', 'nx run-many -t check',
        ];
        report(Object.fromEntries(cmds.map((c) => [c, m.isRecursiveCheck(c)])));
      `);
      for (const [cmd, recursive] of Object.entries(result)) {
        expect(recursive ? cmd : `NOT DETECTED: ${cmd}`).toBe(cmd);
      }
    });

    it('leaves the root project\'s own steps alone', () => {
      const result = inCheck<Record<string, boolean>>(`
        const cmds = [
          'pnpm run check:workspace', 'pnpm run check:pin', 'pnpm run check:ci',
          'pnpm run build', 'node scripts/check-workspace-consistency.mjs',
        ];
        report(Object.fromEntries(cmds.map((c) => [c, m.isRecursiveCheck(c)])));
      `);
      for (const [cmd, recursive] of Object.entries(result)) {
        expect(recursive ? `WRONGLY STRIPPED: ${cmd}` : cmd).toBe(cmd);
      }
    });
  });

  describe('CLI entry resolution', () => {
    it('reports the real entry as the entry', () => {
      const result = inCheck<{ isEntry: boolean }>(`
        const self = new URL(${JSON.stringify(CHECK)}).pathname;
        report(m.resolveCliEntry(self, self));
      `);
      expect(result.isEntry).toBe(true);
    });

    it('flags an unresolvable entry rather than silently reporting "not the entry"', () => {
      // Fail-closed: treating "cannot tell" as "not the CLI" makes
      // `node scripts/check.mjs` print nothing and exit 0 — a green gate that
      // never ran.
      const result = inCheck<{ isEntry: boolean; unresolvable: boolean }>(`
        const r = m.resolveCliEntry('/definitely/not/here-' + Date.now() + '.mjs', ${JSON.stringify(CHECK)}.replace('file://',''));
        report({ isEntry: r.isEntry, unresolvable: Boolean(r.unresolvable) });
      `);
      expect(result.isEntry).toBe(false);
      expect(result.unresolvable).toBe(true);
    });

    it('reports a different real file as not the entry', () => {
      const result = inCheck<{ isEntry: boolean; unresolvable: boolean }>(`
        const self = new URL(${JSON.stringify(CHECK)}).pathname;
        const other = new URL(${JSON.stringify(templateUrl('build-test-gate.mjs'))}).pathname;
        const r = m.resolveCliEntry(other, self);
        report({ isEntry: r.isEntry, unresolvable: Boolean(r.unresolvable) });
      `);
      expect(result.isEntry).toBe(false);
      expect(result.unresolvable).toBe(false);
    });
  });
});
