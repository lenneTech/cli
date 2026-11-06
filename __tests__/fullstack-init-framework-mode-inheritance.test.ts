/**
 * `--framework-mode` is the workspace-wide default; `--frontend-framework-mode`
 * is the frontend-specific override.
 *
 * Before this fix, the frontend resolution never consulted `frameworkMode` at
 * all. A caller running
 *
 *   lt fullstack init --name x --framework-mode npm --noConfirm
 *
 * got `api = npm` but `frontend = vendor`, because the frontend branch fell
 * straight through to its hard-coded `vendor` default. Nothing in the output
 * said so — the vendoring only showed up as the `M1..M3` steps in a `--dry-run`
 * plan, or, without a dry run, as an unexpected `app/core/` tree with a
 * `VENDOR.md` in it. Found while scaffolding `lt-radar` on 2026-08-02.
 *
 * Four invariants need to hold:
 *
 *   1. An explicit `--frontend-framework-mode` always wins.
 *   2. Absent that, `--framework-mode` propagates to the frontend.
 *   3. The hard-coded `vendor` default only applies when neither CLI flag nor
 *      config supplies a value.
 *   4. The non-interactive hint documents `--frontend-framework-mode`, since it
 *      is the only discovery surface scripted consumers have.
 *
 * We assert against the source string, matching the style of
 * `fullstack-init-next-frontend-branch.test.ts` — running the full gluegun
 * command in-process would require mocking the entire frontend helper, git and
 * prompt surface without buying meaningful coverage for a precedence chain.
 */
describe('Fullstack init framework-mode inheritance — resolved VALUE', () => {
  // The source-string tests below assert that `cliFrameworkMode` is READ, and at
  // which position in the chain. They cannot see WHICH value it resolves to:
  // `frontendFrameworkMode = cliFrameworkMode === 'npm' ? 'vendor' : 'npm'` — the
  // exact inversion of the bug being fixed — passes every one of them.
  //
  // `--dry-run` already prints the resolved value and touches nothing, so the
  // behavioural check costs one spawn per case and no mocking.
  const nodeFs = require('fs');
  const nodePath = require('path');
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const os = require('os') as typeof import('os');

  const resolve = (args: string[]): string => {
    const tmp = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'lt-fm-'));
    try {
      const res = spawnSync(
        process.execPath,
        [
          nodePath.join(__dirname, '..', 'bin', 'lt'),
          'fullstack',
          'init',
          '--name',
          'probe',
          '--frontend',
          'nuxt',
          '--dry-run',
          '--noConfirm',
          ...args,
        ],
        { cwd: tmp, encoding: 'utf8', timeout: 120_000 },
      );
      const out = `${res.stdout}${res.stderr}`;
      const m = /frontendFrameworkMode:\s*(npm|vendor)/.exec(out);
      if (!m) throw new Error(`no frontendFrameworkMode in dry-run output:\n${out.slice(0, 2000)}`);
      return m[1];
    } finally {
      nodeFs.rmSync(tmp, { force: true, recursive: true });
    }
  };

  test('--framework-mode npm propagates to the frontend', () => {
    expect(resolve(['--framework-mode', 'npm'])).toBe('npm');
  }, 120_000);

  test('--framework-mode vendor propagates to the frontend', () => {
    expect(resolve(['--framework-mode', 'vendor'])).toBe('vendor');
  }, 120_000);

  test('--frontend-framework-mode overrides the workspace-wide flag', () => {
    expect(resolve(['--framework-mode', 'npm', '--frontend-framework-mode', 'vendor'])).toBe('vendor');
    expect(resolve(['--framework-mode', 'vendor', '--frontend-framework-mode', 'npm'])).toBe('npm');
  }, 120_000);

  test('neither flag given falls back to the vendor default', () => {
    expect(resolve([])).toBe('vendor');
  }, 120_000);
});

describe('Fullstack init framework-mode inheritance', () => {
  // Lazy require to avoid colliding with the top-level `fs` / `path`
  // declarations in other test files (see the header comment in
  // `fullstack-init-next-frontend-branch.test.ts`).
  const nodeFs = require('fs');
  const nodePath = require('path');
  const read = (...segments: string[]): string =>
    nodeFs.readFileSync(nodePath.join(__dirname, '..', ...segments), 'utf8');
  const initSource: string = read('src', 'commands', 'fullstack', 'init.ts');
  // The chain lives in one function since `add-app` shares it (frontend-mode-resolution.ts);
  // its values are unit-tested in frontend-kind.test.ts, its order is pinned here.
  const resolverSource: string = read('src', 'lib', 'frontend-mode-resolution.ts');

  /** The body of `resolveFrontendFrameworkMode`. */
  const resolutionBlock = (): string => {
    const start = resolverSource.indexOf('export function resolveFrontendFrameworkMode(');
    expect(start).toBeGreaterThanOrEqual(0);
    return resolverSource.slice(resolverSource.indexOf('): FrontendFrameworkModeResolution {', start));
  };

  test('init and add-app both hand the workspace-wide flag to the shared chain', () => {
    expect(initSource).toMatch(/resolveFrontendFrameworkMode\(\{[^}]*cliFrameworkMode,/s);
    expect(read('src', 'commands', 'fullstack', 'add-app.ts')).toMatch(
      /resolveFrontendFrameworkMode\(\{[^}]*cliFrameworkMode: parameters\.options\['framework-mode'\]/s,
    );
  });

  test('explicit --frontend-framework-mode is checked before anything else', () => {
    const block = resolutionBlock();
    const explicitIdx = block.indexOf('valid(cliFrontendFrameworkMode)');
    const inheritedIdx = block.indexOf('valid(cliFrameworkMode)');
    expect(explicitIdx).toBeGreaterThanOrEqual(0);
    expect(inheritedIdx).toBeGreaterThan(explicitIdx);
  });

  test('--framework-mode propagates to the frontend when no frontend-specific flag is given', () => {
    // This is the actual bug: without a reference to the workspace-wide
    // `cliFrameworkMode`, `--framework-mode npm` leaves the frontend vendored.
    expect(resolutionBlock()).toMatch(/valid\(cliFrameworkMode\)/);
  });

  test('config values are still honoured', () => {
    expect(resolutionBlock()).toMatch(/valid\(configFrontendFrameworkMode\)/);
  });

  test("the hard-coded 'vendor' default comes last in the chain", () => {
    const block = resolutionBlock();
    const inheritedIdx = block.indexOf('valid(cliFrameworkMode)');
    const defaultIdx = block.lastIndexOf("return { mode: 'vendor' };");
    expect(defaultIdx).toBeGreaterThan(inheritedIdx);
  });

  test('non-interactive hint documents --frontend-framework-mode', () => {
    // Scripted consumers (Claude Code included) read this hint and nothing
    // else. Omitting the flag is what made the mismatch undiscoverable.
    const hint = initSource.match(/nonInteractiveHint\(\s*'([^']*)'/);
    expect(hint).not.toBeNull();
    expect(hint![1]).toMatch(/--frontend-framework-mode/);
  });
});
