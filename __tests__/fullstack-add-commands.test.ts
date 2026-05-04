// CLI-level tests for `lt fullstack add-api`, `lt fullstack add-app`,
// and the auto-delegation built into `lt fullstack init`. We exercise
// only the dry-run / refusal paths so the suite stays offline (no
// nest-server-starter or nuxt-base-starter clones), which keeps these
// tests viable in CI without network access.
//
// `export {}` keeps this file a TypeScript module so its top-level
// destructures don't collide with neighbouring test files (TS2451 in
// ts-jest's shared program).
export {};

import { filesystem, system } from 'gluegun';

const src: string = filesystem.path(__dirname, '..');

/**
 * Run the lt CLI inside `cwd` and return stdout.
 *
 * We do not throw on non-zero exit codes here because some of the
 * paths under test exit with 1 (refusal because the workspace is in
 * the wrong shape). Instead we capture stdout/stderr from the rejected
 * promise and return them concatenated, mirroring the pattern from
 * ocr.test.ts.
 */
async function runCli(cmd: string, cwd: string): Promise<string> {
  try {
    return await system.run(`cd "${cwd}" && node "${filesystem.path(src, 'bin', 'lt')}" ${cmd}`);
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string };
    return `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
  }
}

/** Create a unique scratch directory under `__tests__/`. */
function makeTempDir(prefix: string): string {
  const tempDir = filesystem.path(
    '__tests__',
    `temp-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  filesystem.dir(tempDir);
  return tempDir;
}

/** Bare workspace skeleton with a pnpm-workspace.yaml + projects/ dir. */
function seedWorkspace(workspaceDir: string): void {
  filesystem.write(filesystem.path(workspaceDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
  filesystem.dir(filesystem.path(workspaceDir, 'projects'));
}

function seedApp(workspaceDir: string, name = 'my-app'): void {
  filesystem.write(filesystem.path(workspaceDir, 'projects', 'app', 'package.json'), { name, version: '0.0.0' });
}

function seedApi(workspaceDir: string, name = 'my-api'): void {
  filesystem.write(filesystem.path(workspaceDir, 'projects', 'api', 'package.json'), { name, version: '0.0.0' });
}

describe('lt fullstack add-api', () => {
  test('--help-json describes all init-equivalent flags', async () => {
    const tempDir = makeTempDir('addapi-help');
    try {
      const output = await runCli('fullstack add-api --help-json', tempDir);
      const helpJson = JSON.parse(output);
      const flags = (helpJson.options as { flag: string }[]).map((o) => o.flag);
      // Mirror init's API surface area — keep these in lockstep.
      expect(flags).toEqual(
        expect.arrayContaining([
          '--api-mode',
          '--framework-mode',
          '--framework-upstream-branch',
          '--api-branch',
          '--api-copy',
          '--api-link',
          '--next',
          '--workspace-dir',
          '--dry-run',
          '--noConfirm',
        ]),
      );
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('dry-run prints the resolved plan without touching disk', async () => {
    const tempDir = makeTempDir('addapi-dry');
    try {
      seedWorkspace(tempDir);
      seedApp(tempDir);

      const output = await runCli(
        'fullstack add-api --dry-run --noConfirm --api-mode GraphQL --framework-mode vendor --framework-upstream-branch v12.0.0',
        tempDir,
      );

      expect(output).toContain('Dry-run plan');
      expect(output).toContain('apiMode:');
      expect(output).toContain('GraphQL');
      expect(output).toContain('frameworkMode:');
      expect(output).toContain('vendor');
      expect(output).toContain('frameworkUpstreamBranch:');
      expect(output).toContain('v12.0.0');

      // Nothing on disk should have been created or modified.
      expect(filesystem.exists(filesystem.path(tempDir, 'projects', 'api'))).toBe(false);
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('refuses to run when projects/api already exists', async () => {
    const tempDir = makeTempDir('addapi-refuse');
    try {
      seedWorkspace(tempDir);
      seedApi(tempDir);
      const output = await runCli(
        'fullstack add-api --noConfirm --api-mode Rest --framework-mode npm',
        tempDir,
      );
      expect(output).toMatch(/already exists at/i);
      expect(output).toContain('projects/api');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('refuses to run when no workspace is present', async () => {
    const tempDir = makeTempDir('addapi-noworkspace');
    try {
      // No pnpm-workspace.yaml, no projects/ → not a workspace.
      const output = await runCli(
        'fullstack add-api --noConfirm --api-mode Rest --framework-mode npm',
        tempDir,
      );
      expect(output).toMatch(/no fullstack workspace detected/i);
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('walks up from a sub-directory to find the workspace root', async () => {
    // User runs `lt fullstack add-api` from inside
    // `projects/app/src/components` — without auto-walk-up they would
    // hit "no workspace detected" and have to manually pass
    // `--workspace-dir ../../..`. This is the regression guard for
    // that ergonomic fix.
    const tempDir = makeTempDir('addapi-walkup');
    try {
      seedWorkspace(tempDir);
      seedApp(tempDir);
      const inner = filesystem.path(tempDir, 'projects', 'app', 'src', 'components');
      filesystem.dir(inner);
      const output = await runCli(
        'fullstack add-api --dry-run --noConfirm --api-mode Rest --framework-mode npm',
        inner,
      );
      // Hint that walk-up kicked in.
      expect(output).toMatch(/walked up from cwd/i);
      // The plan's workspaceDir must point at the actual root, not
      // the inner cwd.
      expect(output).toContain(`workspaceDir:               ${filesystem.path(tempDir)}`);
      expect(output).toContain('Dry-run plan');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('explicit --workspace-dir overrides walk-up', async () => {
    // Two sibling workspaces; cwd is in workspace A, but the user
    // passes --workspace-dir for workspace B. The walk-up must NOT
    // override the explicit flag.
    const tempDir = makeTempDir('addapi-explicit');
    try {
      const wsA = filesystem.path(tempDir, 'ws-a');
      const wsB = filesystem.path(tempDir, 'ws-b');
      seedWorkspace(wsA);
      seedApp(wsA);
      seedWorkspace(wsB);
      seedApp(wsB);
      const inner = filesystem.path(wsA, 'projects', 'app');
      const output = await runCli(
        `fullstack add-api --dry-run --noConfirm --api-mode Rest --framework-mode npm --workspace-dir ${wsB}`,
        inner,
      );
      // workspaceDir in the plan must be wsB, not wsA.
      expect(output).toContain(`workspaceDir:               ${wsB}`);
      expect(output).not.toMatch(/walked up from cwd/i);
    } finally {
      filesystem.remove(tempDir);
    }
  });
});

describe('lt fullstack add-app', () => {
  test('--help-json describes all init-equivalent frontend flags', async () => {
    const tempDir = makeTempDir('addapp-help');
    try {
      const output = await runCli('fullstack add-app --help-json', tempDir);
      const helpJson = JSON.parse(output);
      const flags = (helpJson.options as { flag: string }[]).map((o) => o.flag);
      expect(flags).toEqual(
        expect.arrayContaining([
          '--frontend',
          '--frontend-framework-mode',
          '--frontend-branch',
          '--frontend-copy',
          '--frontend-link',
          '--next',
          '--workspace-dir',
          '--dry-run',
          '--noConfirm',
        ]),
      );
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('dry-run prints the resolved plan without touching disk', async () => {
    const tempDir = makeTempDir('addapp-dry');
    try {
      seedWorkspace(tempDir);
      seedApi(tempDir);
      const output = await runCli(
        'fullstack add-app --dry-run --noConfirm --frontend nuxt --frontend-framework-mode vendor',
        tempDir,
      );
      expect(output).toContain('Dry-run plan');
      expect(output).toContain('frontend:');
      expect(output).toContain('nuxt');
      expect(output).toContain('frontendFrameworkMode:');
      expect(output).toContain('vendor');
      expect(filesystem.exists(filesystem.path(tempDir, 'projects', 'app'))).toBe(false);
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('--next defaults the nuxt-base-starter branch to "next"', async () => {
    const tempDir = makeTempDir('addapp-next');
    try {
      seedWorkspace(tempDir);
      seedApi(tempDir);
      const output = await runCli(
        'fullstack add-app --dry-run --noConfirm --frontend nuxt --next',
        tempDir,
      );
      expect(output).toMatch(/frontendBranch:\s+next/);
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('refuses when projects/app already exists', async () => {
    const tempDir = makeTempDir('addapp-refuse');
    try {
      seedWorkspace(tempDir);
      seedApp(tempDir);
      const output = await runCli(
        'fullstack add-app --noConfirm --frontend nuxt',
        tempDir,
      );
      expect(output).toMatch(/already exists at/i);
      expect(output).toContain('projects/app');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('walks up from a sub-directory to find the workspace root', async () => {
    const tempDir = makeTempDir('addapp-walkup');
    try {
      seedWorkspace(tempDir);
      seedApi(tempDir);
      const inner = filesystem.path(tempDir, 'projects', 'api', 'src');
      filesystem.dir(inner);
      const output = await runCli(
        'fullstack add-app --dry-run --noConfirm --frontend nuxt',
        inner,
      );
      expect(output).toMatch(/walked up from cwd/i);
      expect(output).toContain(`workspaceDir:               ${filesystem.path(tempDir)}`);
      expect(output).toContain('Dry-run plan');
    } finally {
      filesystem.remove(tempDir);
    }
  });
});

describe('lt fullstack init auto-delegation', () => {
  test('delegates to add-api when only projects/app is present', async () => {
    const tempDir = makeTempDir('init-only-app');
    try {
      seedWorkspace(tempDir);
      seedApp(tempDir);
      const output = await runCli(
        'fullstack init --dry-run --noConfirm --api-mode Rest --framework-mode npm',
        tempDir,
      );
      expect(output).toContain('delegating to `lt fullstack add-api`');
      expect(output).toContain('Dry-run plan');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('delegates to add-app when only projects/api is present', async () => {
    const tempDir = makeTempDir('init-only-api');
    try {
      seedWorkspace(tempDir);
      seedApi(tempDir);
      const output = await runCli(
        'fullstack init --dry-run --noConfirm --frontend nuxt --frontend-framework-mode npm',
        tempDir,
      );
      expect(output).toContain('delegating to `lt fullstack add-app`');
      expect(output).toContain('Dry-run plan');
    } finally {
      filesystem.remove(tempDir);
    }
  });

  test('refuses when both subprojects already exist', async () => {
    const tempDir = makeTempDir('init-both');
    try {
      seedWorkspace(tempDir);
      seedApi(tempDir);
      seedApp(tempDir);
      const output = await runCli('fullstack init --noConfirm', tempDir);
      expect(output).toMatch(/already has both projects\/api and projects\/app/);
    } finally {
      filesystem.remove(tempDir);
    }
  });
});
