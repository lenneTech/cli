// Test file shares one TypeScript program with the rest of `__tests__/`
// under ts-jest, so any top-level `const fs = require('fs')` clashes
// with other files' globals (TS2451). The neighbouring
// `fullstack-init-next-rename.test.ts` already owns the unprefixed
// `fs` / `path` names, so this file requires Node's built-ins inside
// the describe block where their scope is local. See the header
// comment in `fullstack-init-next-rename.test.ts` for the same
// rationale around `filesystem` / `patching`.

/**
 * `--next` defaults the frontend git ref to `nuxt-base-starter#next`.
 *
 * The `next` branch on `lenneTech/nuxt-base-starter` ships an auth
 * `basePath` aligned with `nest-base` (`/api/auth`) instead of the
 * `nest-server-starter` default (`/iam`). Without this default, the
 * Better-Auth handshake between the experimental `--next` API and the
 * cloned frontend lands on a 404 and the user has to discover
 * `--frontend-branch next` themselves (LLM-test 2026-05-03 friction #5,
 * blocker).
 *
 * Two invariants need to hold:
 *
 *   1. When `--next` is set and no explicit `--frontend-branch` is
 *      supplied, init.ts derives `frontendBranch === 'next'` and
 *      passes it through to `frontendHelper.setupNuxt`.
 *   2. An explicit `--frontend-branch <ref>` always wins, including
 *      under `--next`, so consumers can target a custom branch on
 *      either the legacy or `next`-derived line.
 *
 * Without `--next`, behaviour is unchanged: `frontendBranch` falls
 * back to `cliFrontendBranch || configFrontendBranch` and is
 * `undefined` if neither is provided (clones the default branch).
 *
 * We assert against the source string (same style as
 * `fullstack-init-next-rename.test.ts`) — running the full gluegun
 * command in-process would require mocking out the entire frontend
 * helper, git, and prompts surface, which adds maintenance cost
 * without buying meaningful coverage for a one-liner derivation.
 */
describe('Fullstack init --next frontend branch default', () => {
  // Lazy require to avoid colliding with the top-level `fs` / `path`
  // declarations in other test files (see header comment).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('path');
  const initSource: string = nodeFs.readFileSync(
    nodePath.join(__dirname, '..', 'src', 'commands', 'fullstack', 'init.ts'),
    'utf8',
  );

  test('frontendBranch derivation prefers explicit --frontend-branch over the --next default', () => {
    // The derivation must explicitly check `cliFrontendBranch` first so
    // an explicit `--frontend-branch <ref>` overrides the experimental
    // default. We allow either a direct truthy/length check; what we
    // care about is that `cliFrontendBranch` appears before the
    // `experimental` ternary that supplies `'next'`.
    const derivation = initSource.match(/const frontendBranch =[^;]*;/);
    expect(derivation).not.toBeNull();
    const expr = derivation![0];

    // Explicit CLI flag is checked first.
    expect(expr).toMatch(/cliFrontendBranch/);
    // Experimental default falls through to 'next'.
    expect(expr).toMatch(/experimental/);
    expect(expr).toMatch(/'next'/);

    // Sanity: `cliFrontendBranch` is referenced before `'next'` in the
    // expression, so the explicit value wins.
    const cliIdx = expr.indexOf('cliFrontendBranch');
    const nextIdx = expr.indexOf("'next'");
    expect(cliIdx).toBeGreaterThanOrEqual(0);
    expect(nextIdx).toBeGreaterThan(cliIdx);
  });

  test('no --next flag preserves the legacy fallback (cli > config > undefined)', () => {
    // The legacy `cliFrontendBranch || configFrontendBranch` chain must
    // remain inside the new derivation so non-experimental users still
    // get the default branch when neither flag nor config sets one.
    const derivation = initSource.match(/const frontendBranch =[^;]*;/);
    expect(derivation).not.toBeNull();
    expect(derivation![0]).toMatch(/configFrontendBranch/);
  });

  test('frontendBranch is forwarded into frontendHelper.setupNuxt unchanged', () => {
    // The single-line derivation only matters if it's the value that
    // setupNuxt actually receives. Guard against a future refactor
    // that re-derives a separate branch for the nuxt path and
    // accidentally drops the experimental default.
    const setupNuxtCall = initSource.match(/frontendHelper\.setupNuxt\([^)]*,\s*\{[\s\S]*?\}\)/);
    expect(setupNuxtCall).not.toBeNull();
    expect(setupNuxtCall![0]).toMatch(/branch:\s*frontendBranch/);
  });

  test('CLI usage hint mentions that --next implies the nuxt-base-starter next branch', () => {
    // The non-interactive hint is the only documentation surface
    // Claude Code / scripted consumers see for `--next`, so it must
    // surface this implicit default. `--frontend-branch` overriding it
    // is the well-known precedence rule and doesn't need to be
    // restated here, but the hint must at least name the implicit
    // default so users searching for "next branch" find it.
    expect(initSource).toMatch(/--next[^]*?nuxt-base-starter[^]*?next/);
  });
});
