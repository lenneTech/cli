// CLI tests for the standalone scaffolding commands `lt server create`,
// `lt frontend nuxt`, and `lt frontend angular`. We exercise only the
// dry-run / refusal paths so the suite stays offline (no real clones).
//
// `export {}` keeps this file a TS module so the top-level
// `system`/`filesystem` destructure does not collide with neighbours
// (TS2451 under ts-jest's shared program).
export {};

import { filesystem, system } from 'gluegun';

const src: string = filesystem.path(__dirname, '..');

async function runCli(cmd: string, cwd: string): Promise<string> {
  try {
    return await system.run(`cd "${cwd}" && node "${filesystem.path(src, 'bin', 'lt')}" ${cmd}`);
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string };
    return `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
  }
}

function makeTempDir(prefix: string): string {
  const tempDir = filesystem.path(
    '__tests__',
    `temp-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  filesystem.dir(tempDir);
  return tempDir;
}

function seedWorkspace(workspaceDir: string, with_: { api?: boolean; app?: boolean } = {}): void {
  filesystem.write(filesystem.path(workspaceDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
  filesystem.dir(filesystem.path(workspaceDir, 'projects'));
  if (with_.api) filesystem.write(filesystem.path(workspaceDir, 'projects', 'api', 'package.json'), { name: 'api' });
  if (with_.app) filesystem.write(filesystem.path(workspaceDir, 'projects', 'app', 'package.json'), { name: 'app' });
}

// Three commands' help-json contracts are identical-shape (just JSON
// schema fetches). `test.concurrent` runs the three independent
// spawns in parallel within the same suite, halving the wall-clock
// time of the help-inventory section.
describe('help-json contracts (parallel)', () => {
  test.concurrent('lt server create advertises full init/add-api parity', async () => {
    const tempDir = makeTempDir('srv-help');
    try {
      const output = await runCli('server create --help-json', tempDir);
      const help = JSON.parse(output);
      const flags = (help.options as { flag: string }[]).map((o) => o.flag);
      expect(flags).toEqual(
        expect.arrayContaining([
          '--name',
          '--api-mode',
          '--branch',
          '--copy',
          '--link',
          '--framework-mode',
          '--framework-upstream-branch',
          '--next',
          '--dry-run',
          '--force',
          '--noConfirm',
        ]),
      );
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test.concurrent('lt frontend nuxt advertises full init/add-app parity', async () => {
    const tempDir = makeTempDir('nuxt-help');
    try {
      const output = await runCli('frontend nuxt --help-json', tempDir);
      const help = JSON.parse(output);
      const flags = (help.options as { flag: string }[]).map((o) => o.flag);
      expect(flags).toEqual(
        expect.arrayContaining([
          '--name',
          '--branch',
          '--copy',
          '--link',
          '--frontend-framework-mode',
          '--next',
          '--dry-run',
          '--force',
          '--noConfirm',
        ]),
      );
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test.concurrent('lt frontend angular advertises dry-run + workspace-aware flags', async () => {
    const tempDir = makeTempDir('ng-help');
    try {
      const output = await runCli('frontend angular --help-json', tempDir);
      const help = JSON.parse(output);
      const flags = (help.options as { flag: string }[]).map((o) => o.flag);
      expect(flags).toEqual(
        expect.arrayContaining(['--name', '--branch', '--copy', '--link', '--dry-run', '--force', '--noConfirm']),
      );
    } finally {
      filesystem.remove(tempDir);
    }
  });
});

describe('lt server create — surface parity with fullstack init / add-api', () => {

  test('dry-run outside a workspace prints the resolved plan and writes nothing', async () => {
    const tempDir = makeTempDir('srv-dry');
    try {
      const output = await runCli(
        'server create --name my-srv --api-mode GraphQL --framework-mode vendor --framework-upstream-branch v12 --dry-run --noConfirm',
        tempDir,
      );
      expect(output).toContain('Dry-run plan');
      expect(output).toContain('apiMode:');
      expect(output).toContain('GraphQL');
      expect(output).toContain('frameworkMode:');
      expect(output).toContain('vendor');
      expect(output).toContain('frameworkUpstreamBranch:');
      expect(output).toContain('v12');
      // No `my-srv/` was created.
      expect(filesystem.exists(filesystem.path(tempDir, 'my-srv'))).toBe(false);
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('refuses (exit 1) inside a workspace under --noConfirm without --force', async () => {
    const tempDir = makeTempDir('srv-ws-refuse');
    try {
      seedWorkspace(tempDir, { app: true });
      const output = await runCli(
        'server create --name standalone --api-mode Rest --framework-mode npm --noConfirm',
        tempDir,
      );
      expect(output).toMatch(/refusing to create a standalone server/i);
      expect(output).toContain('lt fullstack add-api');
      // The dry-run plan must NOT appear: refusal happens before the
      // dry-run print-out so a CI script can't accidentally treat the
      // refused run as a successful preview.
      expect(output).not.toContain('Dry-run plan');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('proceeds inside a workspace under --noConfirm --force', async () => {
    const tempDir = makeTempDir('srv-ws-force');
    try {
      seedWorkspace(tempDir, { app: true });
      const output = await runCli(
        'server create --name standalone --api-mode Rest --framework-mode npm --dry-run --noConfirm --force',
        tempDir,
      );
      expect(output).toContain('--force set — continuing despite workspace context');
      expect(output).toContain('Dry-run plan');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('honours the --name flag instead of falling back to the interactive prompt', async () => {
    const tempDir = makeTempDir('srv-name');
    try {
      const output = await runCli(
        'server create --name explicit-name --api-mode Rest --framework-mode npm --dry-run --noConfirm',
        tempDir,
      );
      expect(output).toMatch(/projectDir:\s+explicit-name/);
    } finally {
      filesystem.remove(tempDir);
    }
  });
});

describe('lt frontend nuxt — surface parity with fullstack init / add-app', () => {
  test('dry-run with --next defaults the branch to "next"', async () => {
    const tempDir = makeTempDir('nuxt-next');
    try {
      const output = await runCli(
        'frontend nuxt --name my-app --next --dry-run --noConfirm',
        tempDir,
      );
      expect(output).toMatch(/branch:\s+next/);
      expect(output).toContain('experimental (--next):      true');
      expect(filesystem.exists(filesystem.path(tempDir, 'my-app'))).toBe(false);
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('dry-run with --frontend-framework-mode vendor lists the vendor steps', async () => {
    const tempDir = makeTempDir('nuxt-vendor');
    try {
      const output = await runCli(
        'frontend nuxt --name my-app --frontend-framework-mode vendor --dry-run --noConfirm',
        tempDir,
      );
      expect(output).toContain('frontendFrameworkMode:      vendor');
      expect(output).toMatch(/vendor app\/core\//);
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('refuses (exit 1) inside a workspace under --noConfirm without --force', async () => {
    const tempDir = makeTempDir('nuxt-ws-refuse');
    try {
      seedWorkspace(tempDir, { api: true });
      const output = await runCli('frontend nuxt --name standalone --noConfirm', tempDir);
      expect(output).toMatch(/refusing to create a standalone nuxt app/i);
      expect(output).toContain('lt fullstack add-app --frontend nuxt');
      expect(output).not.toContain('Dry-run plan');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('proceeds inside a workspace under --noConfirm --force', async () => {
    const tempDir = makeTempDir('nuxt-ws-force');
    try {
      seedWorkspace(tempDir, { api: true });
      const output = await runCli(
        'frontend nuxt --name standalone --dry-run --noConfirm --force',
        tempDir,
      );
      expect(output).toContain('--force set — continuing despite workspace context');
      expect(output).toContain('Dry-run plan');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('refuses under --noConfirm without an explicit --name', async () => {
    const tempDir = makeTempDir('nuxt-noname');
    try {
      const output = await runCli('frontend nuxt --noConfirm', tempDir);
      expect(output).toMatch(/missing workspace name/i);
    } finally {
      filesystem.remove(tempDir);
    }
  });
});

describe('lt frontend angular — surface parity with fullstack init / add-app', () => {
  test('dry-run prints the resolved plan and writes nothing', async () => {
    const tempDir = makeTempDir('ng-dry');
    try {
      const output = await runCli(
        'frontend angular --name my-ng --noLocalize --dry-run --noConfirm',
        tempDir,
      );
      expect(output).toContain('Dry-run plan');
      expect(output).toMatch(/localize:\s+false/);
      expect(filesystem.exists(filesystem.path(tempDir, 'my-ng'))).toBe(false);
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('refuses (exit 1) inside a workspace under --noConfirm without --force', async () => {
    const tempDir = makeTempDir('ng-ws-refuse');
    try {
      seedWorkspace(tempDir, { api: true });
      const output = await runCli(
        'frontend angular --name standalone --noLocalize --noConfirm',
        tempDir,
      );
      expect(output).toMatch(/refusing to create a standalone angular app/i);
      expect(output).toContain('lt fullstack add-app --frontend angular');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('proceeds inside a workspace under --noConfirm --force', async () => {
    const tempDir = makeTempDir('ng-ws-force');
    try {
      seedWorkspace(tempDir, { api: true });
      const output = await runCli(
        'frontend angular --name standalone --noLocalize --dry-run --noConfirm --force',
        tempDir,
      );
      expect(output).toContain('--force set — continuing despite workspace context');
      expect(output).toContain('Dry-run plan');
    } finally {
      filesystem.remove(tempDir);
    }
  });
});
