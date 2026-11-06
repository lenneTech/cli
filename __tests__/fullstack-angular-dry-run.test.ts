/**
 * `lt fullstack init` / `add-app` with `--frontend angular`, as dry runs.
 *
 * Before the Angular stack became first-class, both commands printed the Nuxt plan
 * for an Angular app: `--next` pointed ng-base-starter at a `next` branch it does
 * not have, the vendor steps named nuxt-extensions, and add-app defaulted to npm
 * mode where init defaulted to vendor.
 */
import { mkdtempSync, realpathSync } from 'fs';
import { filesystem, system } from 'gluegun';
import { tmpdir } from 'os';
import { join } from 'path';

const src = filesystem.path(__dirname, '..');
const TMP_ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'lt-cli-angular-')));

/** Runs the CLI in `cwd` and returns stdout + stderr, also for a failing exit code. */
async function runCli(cmd: string, cwd: string): Promise<string> {
  try {
    return await system.run(`node "${filesystem.path(src, 'bin', 'lt')}" ${cmd}`, { cwd });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string };
    return `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
  }
}

function seedWorkspaceWithApi(dir: string): void {
  filesystem.write(filesystem.path(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
  filesystem.write(filesystem.path(dir, 'projects', 'api', 'package.json'), { name: 'my-api', version: '0.0.0' });
}

afterAll(() => {
  filesystem.remove(TMP_ROOT);
});

describe('fullstack init --frontend angular --dry-run', () => {
  test('plans the ng-base vendoring, and --next leaves the ng-base-starter branch alone', async () => {
    const output = await runCli(
      'fullstack init --name demo --dry-run --noConfirm --frontend angular --api-mode Rest --next',
      TMP_ROOT,
    );
    expect(output).toContain('Dry-run plan');
    expect(output).toMatch(/frontendBranch:\s+\(default\)/);
    expect(output).toMatch(/frontendFrameworkMode:\s+vendor/);
    expect(output).toContain('@lenne.tech/ng-base');
    expect(output).not.toContain('nuxt-extensions');
    expect(filesystem.exists(filesystem.path(TMP_ROOT, 'demo'))).toBe(false);
  });

  test('names a local ng-base source', async () => {
    const output = await runCli(
      'fullstack init --name demo2 --dry-run --noConfirm --frontend angular --api-mode Rest --frontend-framework-copy /tmp/ng-base',
      TMP_ROOT,
    );
    expect(output).toMatch(/frontendFrameworkCopy:\s+\/tmp\/ng-base/);
    expect(output).toContain('copy @lenne.tech/ng-base from /tmp/ng-base (working tree)');
  });
});

describe('fullstack add-app --frontend angular --dry-run', () => {
  test('defaults to vendor like init, and plans the ng-base vendoring', async () => {
    const ws = filesystem.path(TMP_ROOT, 'ws-vendor');
    seedWorkspaceWithApi(ws);
    const output = await runCli('fullstack add-app --dry-run --noConfirm --frontend angular', ws);
    expect(output).toMatch(/frontendFrameworkMode:\s+vendor/);
    expect(output).toContain('clone @lenne.tech/ng-base');
    expect(output).not.toContain('nuxt-extensions');
    expect(filesystem.exists(filesystem.path(ws, 'projects', 'app'))).toBe(false);
  });

  test('inherits the workspace-wide --framework-mode', async () => {
    const ws = filesystem.path(TMP_ROOT, 'ws-npm');
    seedWorkspaceWithApi(ws);
    const output = await runCli('fullstack add-app --dry-run --noConfirm --frontend angular --framework-mode npm', ws);
    expect(output).toMatch(/frontendFrameworkMode:\s+npm/);
    expect(output).not.toContain('@lenne.tech/ng-base');
  });
});

describe('--frontend-framework-copy', () => {
  /** A local ng-base checkout in the `ng g library` layout, optionally with a build. */
  function seedNgBase(dir: string, built: boolean): void {
    filesystem.write(filesystem.path(dir, 'projects', 'ng-base', 'ng-package.json'), {
      dest: '../../dist/ng-base',
      lib: { entryFile: 'src/public-api.ts' },
    });
    filesystem.write(filesystem.path(dir, 'projects', 'ng-base', 'src', 'public-api.ts'), 'export const LT = 1;\n');
    if (built) {
      filesystem.write(filesystem.path(dir, 'dist', 'ng-base', 'package.json'), { name: '@lenne.tech/ng-base' });
    }
  }

  test('has no effect on the Nuxt path: the plan is identical with and without it', async () => {
    const ngBase = filesystem.path(TMP_ROOT, 'ng-base-nuxt');
    seedNgBase(ngBase, false);
    for (const mode of ['npm', 'vendor']) {
      const base = `fullstack init --name nx --dry-run --noConfirm --frontend nuxt --api-mode Rest --frontend-framework-mode ${mode}`;
      const without = await runCli(base, TMP_ROOT);
      const withCopy = await runCli(`${base} --frontend-framework-copy ${ngBase}`, TMP_ROOT);
      expect(withCopy).toContain('Dry-run plan');
      expect(withCopy).toBe(without);
    }
    // Four CLI starts: more than the default 60 s on a loaded machine.
  }, 240_000);

  test('Angular npm mode refuses a checkout without a build, before writing anything', async () => {
    const ngBase = filesystem.path(TMP_ROOT, 'ng-base-unbuilt');
    seedNgBase(ngBase, false);
    const output = await runCli(
      `fullstack init --name ng-local --dry-run --noConfirm --frontend angular --api-mode Rest --framework-mode npm --frontend-framework-copy ${ngBase}`,
      TMP_ROOT,
    );
    expect(output).toContain('No ng-base build at');
    expect(output).not.toContain('Dry-run plan');
    expect(filesystem.exists(filesystem.path(TMP_ROOT, 'ng-local'))).toBe(false);
  });

  test('Angular npm mode plans an injected file: dependency on the build', async () => {
    const ngBase = filesystem.path(TMP_ROOT, 'ng-base-built');
    seedNgBase(ngBase, true);
    const output = await runCli(
      `fullstack init --name ng-local2 --dry-run --noConfirm --frontend angular --api-mode Rest --framework-mode npm --frontend-framework-copy ${ngBase}`,
      TMP_ROOT,
    );
    expect(output).toContain(
      `@lenne.tech/ng-base as injected file: dependency on ${filesystem.path(ngBase, 'dist', 'ng-base')}`,
    );
  });
});

describe('fullstack convert-mode with an unusable local ng-base', () => {
  test('is refused before the plan, so the backend is never converted alone', async () => {
    const ws = filesystem.path(TMP_ROOT, 'ws-convert');
    filesystem.write(filesystem.path(ws, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    filesystem.write(filesystem.path(ws, 'projects', 'api', 'package.json'), { name: 'api' });
    filesystem.write(
      filesystem.path(ws, 'projects', 'api', 'src', 'core', 'VENDOR.md'),
      '# @lenne.tech/nest-server (vendored)\n',
    );
    filesystem.write(filesystem.path(ws, 'projects', 'app', 'angular.json'), '{}');
    filesystem.write(filesystem.path(ws, 'projects', 'app', 'package.json'), { name: 'app' });
    filesystem.write(
      filesystem.path(ws, 'projects', 'app', 'src', 'core', 'VENDOR.md'),
      '# @lenne.tech/ng-base (vendored)\n',
    );
    const unbuilt = filesystem.path(TMP_ROOT, 'ng-base-convert');
    filesystem.write(filesystem.path(unbuilt, 'projects', 'ng-base', 'ng-package.json'), {
      lib: { entryFile: 'src/public-api.ts' },
    });
    filesystem.write(filesystem.path(unbuilt, 'projects', 'ng-base', 'src', 'public-api.ts'), '');
    const output = await runCli(`fullstack convert-mode --to npm --frontend-framework-copy ${unbuilt} --dry-run`, ws);
    expect(output).toContain('No ng-base build at');
    expect(output).not.toContain('Would execute');
    expect(filesystem.exists(filesystem.path(ws, 'projects', 'api', 'src', 'core', 'VENDOR.md'))).toBe('file');
  });
});

describe('deployment create in an Angular workspace', () => {
  test('prints the NG_* stage env and patches nothing', async () => {
    const ws = filesystem.path(TMP_ROOT, 'ws-deploy');
    seedWorkspaceWithApi(ws);
    filesystem.write(filesystem.path(ws, 'package.json'), { name: 'shop', version: '0.0.0' });
    filesystem.write(filesystem.path(ws, 'projects', 'app', 'angular.json'), '{}');
    filesystem.write(filesystem.path(ws, 'projects', 'app', 'package.json'), { name: 'app' });
    const output = await runCli('deployment create Shop --domain shop.example.com --project shop --noConfirm', ws);
    expect(output).toContain('NG_PUBLIC_API_URL=https://api.shop.example.com');
    expect(output).toContain('NG_PUBLIC_SITE_URL=https://shop.example.com');
    expect(output).not.toContain('NUXT_PUBLIC_API_URL');
    expect(output).not.toContain('environment.');
    expect(output).toContain('NG_PUBLIC_APP_ENV=production   (dev stage: develop)');
    expect(output).toContain('NG_LINEAR_API_KEY, NG_LINEAR_TEAM_NAME, NG_LINEAR_PROJECT_NAME');
    // The Linear values are secrets: never printed as a value assignment.
    expect(output).not.toMatch(/NG_LINEAR_\w+=/);
    expect(filesystem.exists(filesystem.path(ws, '.turboops.json'))).toBe('file');
  });

  test('a Nuxt workspace gets none of the Angular lines', async () => {
    const ws = filesystem.path(TMP_ROOT, 'ws-deploy-nuxt');
    seedWorkspaceWithApi(ws);
    filesystem.write(filesystem.path(ws, 'package.json'), { name: 'shop', version: '0.0.0' });
    filesystem.write(filesystem.path(ws, 'projects', 'app', 'nuxt.config.ts'), 'export default {};\n');
    filesystem.write(filesystem.path(ws, 'projects', 'app', 'package.json'), { name: 'app' });
    const output = await runCli('deployment create Shop --domain shop.example.com --project shop --noConfirm', ws);
    expect(output).toContain('NUXT_PUBLIC_API_URL=https://api.shop.example.com');
    expect(output).not.toContain('NG_');
    expect(output).not.toContain('LINEAR');
  });
});
