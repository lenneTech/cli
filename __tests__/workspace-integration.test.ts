// Unit tests for the workspace-integration helpers. These run
// fully in-process and exercise the small amount of "monorepo glue"
// shared by `lt fullstack init`, `lt fullstack add-api`, and
// `lt fullstack add-app`.
//
// `export {}` keeps this file a TS module so the top-level
// `require('gluegun')` does not collide with neighbouring test
// files (see fullstack-claude-md-patching.test.ts header comment).
export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filesystem } = require('gluegun');

import {
  detectSubProjectContext,
  detectWorkspaceLayout,
  findWorkspaceRoot,
  isNonInteractive,
  runExperimentalNestBaseRename,
  runStandaloneWorkspaceGate,
  shouldProceedAsStandalone,
  writeApiConfig,
} from '../src/lib/workspace-integration';

describe('detectWorkspaceLayout', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path('__tests__', `temp-workspace-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    filesystem.remove(tempDir);
  });

  test('reports no workspace when neither pnpm-workspace.yaml nor projects/ exist', () => {
    const layout = detectWorkspaceLayout(tempDir, filesystem);
    expect(layout.hasWorkspace).toBe(false);
    expect(layout.hasApi).toBe(false);
    expect(layout.hasApp).toBe(false);
  });

  test('detects workspace when pnpm-workspace.yaml exists', () => {
    filesystem.write(filesystem.path(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    const layout = detectWorkspaceLayout(tempDir, filesystem);
    expect(layout.hasWorkspace).toBe(true);
  });

  test('detects workspace when projects/ exists even without pnpm-workspace.yaml', () => {
    filesystem.dir(filesystem.path(tempDir, 'projects'));
    const layout = detectWorkspaceLayout(tempDir, filesystem);
    expect(layout.hasWorkspace).toBe(true);
  });

  test('reports hasApi only when projects/api/package.json exists', () => {
    filesystem.dir(filesystem.path(tempDir, 'projects', 'api'));
    // Empty directory — no package.json yet.
    let layout = detectWorkspaceLayout(tempDir, filesystem);
    expect(layout.hasApi).toBe(false);
    expect(layout.hasWorkspace).toBe(true);

    filesystem.write(filesystem.path(tempDir, 'projects', 'api', 'package.json'), { name: 'api' });
    layout = detectWorkspaceLayout(tempDir, filesystem);
    expect(layout.hasApi).toBe(true);
  });

  test('reports hasApp only when projects/app/package.json exists', () => {
    filesystem.write(filesystem.path(tempDir, 'projects', 'app', 'package.json'), { name: 'app' });
    const layout = detectWorkspaceLayout(tempDir, filesystem);
    expect(layout.hasApp).toBe(true);
    expect(layout.hasApi).toBe(false);
  });

  test('reports both halves independently', () => {
    filesystem.write(filesystem.path(tempDir, 'projects', 'api', 'package.json'), { name: 'api' });
    filesystem.write(filesystem.path(tempDir, 'projects', 'app', 'package.json'), { name: 'app' });
    filesystem.write(filesystem.path(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    const layout = detectWorkspaceLayout(tempDir, filesystem);
    expect(layout).toEqual({ hasApi: true, hasApp: true, hasWorkspace: true, workspaceDir: tempDir });
  });
});

describe('writeApiConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path('__tests__', `temp-api-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    filesystem.remove(tempDir);
  });

  test('writes lt.config.json with apiMode + frameworkMode + controller', () => {
    writeApiConfig({ apiDir: tempDir, apiMode: 'GraphQL', filesystem, frameworkMode: 'vendor' });

    const cfg = filesystem.read(filesystem.path(tempDir, 'lt.config.json'), 'json') as Record<string, unknown>;
    expect(cfg).toBeTruthy();
    expect((cfg.meta as Record<string, unknown>).apiMode).toBe('GraphQL');
    expect((cfg.meta as Record<string, unknown>).frameworkMode).toBe('vendor');
    expect(((cfg.commands as Record<string, unknown>).server as Record<string, unknown>)).toEqual({
      module: { controller: 'GraphQL' },
    });
  });

  test('overwrites existing lt.config.json (idempotent on re-run with new values)', () => {
    filesystem.write(filesystem.path(tempDir, 'lt.config.json'), { meta: { apiMode: 'Rest' } });
    writeApiConfig({ apiDir: tempDir, apiMode: 'Both', filesystem, frameworkMode: 'npm' });
    const cfg = filesystem.read(filesystem.path(tempDir, 'lt.config.json'), 'json') as Record<string, unknown>;
    expect((cfg.meta as Record<string, unknown>).apiMode).toBe('Both');
    expect((cfg.meta as Record<string, unknown>).frameworkMode).toBe('npm');
  });
});

describe('runExperimentalNestBaseRename', () => {
  // We don't actually invoke `bun run rename` — that would require the
  // real nest-base template on disk. Instead we verify the prelude
  // (restoring `name = "nest-base"` in package.json) and that the
  // function reports failure non-fatally when the rename script errors.

  let tempDir: string;
  let stubPatching: {
    update: (path: string, fn: (data: Record<string, unknown>) => Record<string, unknown>) => Promise<void>;
  };

  beforeEach(() => {
    tempDir = filesystem.path('__tests__', `temp-rename-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filesystem.dir(tempDir);
    filesystem.write(filesystem.path(tempDir, 'package.json'), { name: 'my-project' });

    stubPatching = {
      update: async (
        path: string,
        fn: (data: Record<string, unknown>) => Record<string, unknown>,
      ): Promise<void> => {
        const data = filesystem.read(path, 'json') as Record<string, unknown>;
        const next = fn(data);
        filesystem.write(path, next);
      },
    };
  });

  afterEach(() => {
    filesystem.remove(tempDir);
  });

  test('restores name = "nest-base" in package.json before invoking rename', async () => {
    const result = await runExperimentalNestBaseRename({
      apiDir: tempDir,
      // Cast through unknown to satisfy the GluegunPatching slot — we
      // only exercise `update`.
      patching: stubPatching as unknown as Parameters<typeof runExperimentalNestBaseRename>[0]['patching'],
      projectDir: 'my-project',
      system: { run: async () => 'ok' },
    });
    expect(result.attempted).toBe(true);
    expect(result.error).toBeUndefined();
    const pkg = filesystem.read(filesystem.path(tempDir, 'package.json'), 'json') as Record<string, unknown>;
    expect(pkg.name).toBe('nest-base');
  });

  test('returns the error non-fatally when the rename script fails', async () => {
    const boom = new Error('bun missing');
    const result = await runExperimentalNestBaseRename({
      apiDir: tempDir,
      patching: stubPatching as unknown as Parameters<typeof runExperimentalNestBaseRename>[0]['patching'],
      projectDir: 'my-project',
      system: {
        run: async () => {
          throw boom;
        },
      },
    });
    expect(result.attempted).toBe(true);
    expect(result.error).toBe(boom);
  });
});

describe('shouldProceedAsStandalone', () => {
  // Interactive: caller already asked the user; we just relay the answer.
  test('interactive yes → proceed', () => {
    expect(
      shouldProceedAsStandalone({
        force: false,
        nonInteractive: false,
        projectKind: 'server',
        suggestion: 'lt fullstack add-api',
        userConfirmed: true,
      }),
    ).toEqual({ proceed: true });
  });

  test('interactive no → refuse with reason mentioning the suggestion', () => {
    const result = shouldProceedAsStandalone({
      force: false,
      nonInteractive: false,
      projectKind: 'server',
      suggestion: 'lt fullstack add-api',
      userConfirmed: false,
    });
    expect(result.proceed).toBe(false);
    expect(result.reason).toContain('lt fullstack add-api');
  });

  // Non-interactive: refuse by default — fail loud for KI/CI callers.
  test('nonInteractive without force → refuse and surface the suggestion', () => {
    const result = shouldProceedAsStandalone({
      force: false,
      nonInteractive: true,
      projectKind: 'Nuxt app',
      suggestion: 'lt fullstack add-app --frontend nuxt',
    });
    expect(result.proceed).toBe(false);
    expect(result.reason).toMatch(/refusing/i);
    expect(result.reason).toContain('Nuxt app');
    expect(result.reason).toContain('lt fullstack add-app --frontend nuxt');
    expect(result.reason).toContain('--force');
  });

  test('nonInteractive with force → proceed', () => {
    expect(
      shouldProceedAsStandalone({
        force: true,
        nonInteractive: true,
        projectKind: 'server',
        suggestion: 'lt fullstack add-api',
      }),
    ).toEqual({ proceed: true });
  });
});

describe('isNonInteractive', () => {
  // We can't reliably stub process.stdin.isTTY across platforms in
  // ts-jest without leaking; assert the noConfirm-only contract and
  // that the function is total (always returns a boolean).
  test('returns true when --noConfirm is set, regardless of TTY', () => {
    expect(isNonInteractive(true)).toBe(true);
  });

  test('without --noConfirm, returns a boolean (TTY-dependent)', () => {
    const result = isNonInteractive(false);
    expect(typeof result).toBe('boolean');
  });
});

describe('findWorkspaceRoot', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = filesystem.path('__tests__', `temp-find-root-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filesystem.dir(tempDir);
  });
  afterEach(() => filesystem.remove(tempDir));

  test('returns the start dir when it itself contains pnpm-workspace.yaml', () => {
    filesystem.write(filesystem.path(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    expect(findWorkspaceRoot(tempDir, filesystem)).toBe(tempDir);
  });

  test('walks up from a sub-directory to find the workspace root', () => {
    filesystem.write(filesystem.path(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    const sub = filesystem.path(tempDir, 'projects', 'api', 'src', 'modules');
    filesystem.dir(sub);
    expect(findWorkspaceRoot(sub, filesystem)).toBe(tempDir);
  });

  test('detects npm/yarn workspaces via package.json#workspaces array', () => {
    filesystem.write(filesystem.path(tempDir, 'package.json'), { name: 'mono', workspaces: ['packages/*'] });
    expect(findWorkspaceRoot(tempDir, filesystem)).toBe(tempDir);
  });

  test('detects yarn-classic workspaces via package.json#workspaces.packages', () => {
    filesystem.write(filesystem.path(tempDir, 'package.json'), {
      name: 'mono',
      workspaces: { nohoist: [], packages: ['packages/*'] },
    });
    expect(findWorkspaceRoot(tempDir, filesystem)).toBe(tempDir);
  });

  test('returns null when no marker is found within depth', () => {
    expect(findWorkspaceRoot(tempDir, filesystem)).toBeNull();
  });
});

describe('detectSubProjectContext', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = filesystem.path('__tests__', `temp-subproj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filesystem.dir(tempDir);
    filesystem.write(filesystem.path(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
  });
  afterEach(() => filesystem.remove(tempDir));

  test('returns null when start dir IS the workspace root', () => {
    expect(detectSubProjectContext(tempDir, filesystem)).toBeNull();
  });

  test('returns kind=api when cwd is inside projects/api', () => {
    const apiSrc = filesystem.path(tempDir, 'projects', 'api', 'src');
    filesystem.dir(apiSrc);
    const result = detectSubProjectContext(apiSrc, filesystem);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('api');
    expect(result?.workspaceRoot).toBe(tempDir);
  });

  test('returns kind=app when cwd is exactly projects/app', () => {
    const appDir = filesystem.path(tempDir, 'projects', 'app');
    filesystem.dir(appDir);
    const result = detectSubProjectContext(appDir, filesystem);
    expect(result?.kind).toBe('app');
  });

  test('returns null when there is no workspace at all', () => {
    const isolated = filesystem.path('__tests__', `temp-noproj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filesystem.dir(isolated);
    try {
      expect(detectSubProjectContext(isolated, filesystem)).toBeNull();
    } finally {
      filesystem.remove(isolated);
    }
  });
});

describe('runStandaloneWorkspaceGate', () => {
  type GatePrint = Parameters<typeof runStandaloneWorkspaceGate>[0]['print'];
  type Captured = { confirmAsks: string[]; errors: string[]; infos: string[] };

  // Tiny stub of the print + confirm surface so we can assert what
  // the gate would have shown the user without a real terminal.
  function makePrint(confirmAnswer: boolean): { captured: Captured; print: GatePrint } {
    const captured: Captured = { confirmAsks: [], errors: [], infos: [] };
    return {
      captured,
      print: {
        confirm: async (msg: string) => {
          captured.confirmAsks.push(msg);
          return confirmAnswer;
        },
        error: (msg: string) => captured.errors.push(msg),
        info: (msg: string) => captured.infos.push(msg),
      },
    };
  }

  // process.exit must not actually terminate the test; replace it for
  // the duration of one call. Mirrors the override pattern used by
  // jest's `process.exit` mocking guides.
  function withMockedExit<T>(fn: () => Promise<T>): Promise<{ exitCode: null | number; result: T }> {
    let exitCode: null | number = null;
    const original = process.exit;
    (process as { exit: (n?: number) => void }).exit = (n?: number) => {
      exitCode = n ?? 0;
      // Throw to short-circuit the awaited code, mimicking exit semantics.
      throw new Error(`__mocked_exit__:${exitCode}`);
    };
    return fn()
      .then((result) => ({ exitCode, result }))
      .catch((err) => {
        if (err instanceof Error && err.message.startsWith('__mocked_exit__:')) {
          return { exitCode, result: undefined as unknown as T };
        }
        throw err;
      })
      .finally(() => {
        process.exit = original;
      });
  }

  let tempDir: string;
  beforeEach(() => {
    tempDir = filesystem.path('__tests__', `temp-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filesystem.dir(tempDir);
  });
  afterEach(() => filesystem.remove(tempDir));

  test('plain dir (no workspace) → returns true without prompting', async () => {
    const { captured, print } = makePrint(false);
    const result = await runStandaloneWorkspaceGate({
      cwd: tempDir,
      filesystem,
      force: false,
      fromGluegunMenu: false,
      noConfirmFlag: false,
      pieceName: 'api',
      print,
      projectKind: 'server',
      suggestion: 'lt fullstack add-api',
    });
    expect(result).toBe(true);
    expect(captured.confirmAsks).toHaveLength(0);
    expect(captured.errors).toHaveLength(0);
  });

  test('workspace + --noConfirm → exits 1 and surfaces suggestion', async () => {
    filesystem.write(filesystem.path(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    const { captured, print } = makePrint(false);
    const { exitCode } = await withMockedExit(() =>
      runStandaloneWorkspaceGate({
        cwd: tempDir,
        filesystem,
        force: false,
        fromGluegunMenu: false,
        noConfirmFlag: true,
        pieceName: 'api',
        print,
        projectKind: 'server',
        suggestion: 'lt fullstack add-api',
      }),
    );
    expect(exitCode).toBe(1);
    expect(captured.errors.join('\n')).toMatch(/refusing/i);
    expect(captured.errors.join('\n')).toContain('lt fullstack add-api');
    expect(captured.confirmAsks).toHaveLength(0);
  });

  test('workspace + --noConfirm + --force → returns true with hint', async () => {
    filesystem.write(filesystem.path(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    const { captured, print } = makePrint(false);
    const result = await runStandaloneWorkspaceGate({
      cwd: tempDir,
      filesystem,
      force: true,
      fromGluegunMenu: false,
      noConfirmFlag: true,
      pieceName: 'api',
      print,
      projectKind: 'server',
      suggestion: 'lt fullstack add-api',
    });
    expect(result).toBe(true);
    expect(captured.infos.some((m) => m.includes('--force set'))).toBe(true);
    expect(captured.errors).toHaveLength(0);
  });

  test('inside sub-project → exits 1 with explicit "go up" hint', async () => {
    filesystem.write(filesystem.path(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    const apiSrc = filesystem.path(tempDir, 'projects', 'api', 'src');
    filesystem.dir(apiSrc);
    const { captured, print } = makePrint(false);
    const { exitCode } = await withMockedExit(() =>
      runStandaloneWorkspaceGate({
        cwd: apiSrc,
        filesystem,
        force: false,
        fromGluegunMenu: false,
        noConfirmFlag: true,
        pieceName: 'app',
        print,
        projectKind: 'Nuxt app',
        suggestion: 'lt fullstack add-app --frontend nuxt',
      }),
    );
    expect(exitCode).toBe(1);
    expect(captured.infos.join('\n')).toMatch(/inside projects\/api/);
    expect(captured.errors.join('\n')).toMatch(/from inside a sub-project/i);
  });
});
