import { execFileSync } from 'child_process';
import { filesystem } from 'gluegun';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const src = filesystem.path(__dirname, '..');
const ltBin = filesystem.path(src, 'bin', 'lt');

/**
 * Run the lt CLI and capture stdout regardless of exit code.
 * `system.run()` from gluegun throws on non-zero exit which hides our
 * structured output, so we use execFileSync directly.
 */
const cli = (args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string => {
  const env = { ...process.env, ...opts.env };
  try {
    return execFileSync('node', [ltBin, ...args], { cwd: opts.cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer | string; stdout?: Buffer | string };
    const stdout = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
    return stdout;
  }
};

const TEMP_REGISTRY_BASE = join(tmpdir(), `lt-cli-it-${process.pid}`);

const setupTempRegistry = (suffix: string) => {
  const dir = join(TEMP_REGISTRY_BASE, suffix);
  mkdirSync(dir, { recursive: true });
  return { env: { LT_PORTS_REGISTRY_PATH: join(dir, 'ports.json') }, registryFile: join(dir, 'ports.json') };
};

const cleanupTempRegistry = () => {
  if (existsSync(TEMP_REGISTRY_BASE)) rmSync(TEMP_REGISTRY_BASE, { force: true, recursive: true });
};

describe('lt ports', () => {
  afterAll(() => cleanupTempRegistry());

  test('default action lists empty registry without crashing', () => {
    const { env } = setupTempRegistry('ports-list');
    const output = cli(['ports'], { env });
    expect(output).toContain('Reserved ports');
  });

  test('check on a free port returns "free"', () => {
    const { env } = setupTempRegistry('ports-check-free');
    // Pick a port that is highly unlikely to be bound on a CI runner.
    // 1 (auth-reserved on most systems) is safer than mid-range high ports
    // that could be claimed by ephemeral connections during the test run.
    const output = cli(['ports', 'check', '47281'], { env });
    expect(output.toLowerCase()).toMatch(/free|in use/);
  });

  test('check without port argument prints usage hint', () => {
    const { env } = setupTempRegistry('ports-check-noarg');
    const output = cli(['ports', 'check'], { env });
    expect(output.toLowerCase()).toContain('usage');
  });
});

describe('lt local init', () => {
  afterAll(() => cleanupTempRegistry());

  test('refuses to register a non-project directory', () => {
    const { env } = setupTempRegistry('init-refuse');
    const empty = join(TEMP_REGISTRY_BASE, 'init-refuse', 'empty-dir');
    mkdirSync(empty, { recursive: true });
    const output = cli(['local', 'init', '--noConfirm'], { cwd: empty, env });
    expect(output.toLowerCase()).toMatch(/no api|not detected|no .*project/);
  });

  test('registers an API-only project and writes the registry file', () => {
    const { env, registryFile } = setupTempRegistry('init-api');
    const project = join(TEMP_REGISTRY_BASE, 'init-api', 'my-api');
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'src', 'config.env.ts'), 'export const x = 1;\n');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'my-api' }));

    cli(['local', 'init', '--noConfirm', '--no-patch'], { cwd: project, env });

    expect(existsSync(registryFile)).toBe(true);
    const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
    expect(registry.projects['my-api']).toBeDefined();
    expect(registry.projects['my-api'].slot).toBeGreaterThanOrEqual(0);
    expect(registry.projects['my-api'].ports.api).toBe(3000 + registry.projects['my-api'].slot * 10);
  });

  test('is idempotent: re-init keeps the same slot', () => {
    const { env, registryFile } = setupTempRegistry('init-idempotent');
    const project = join(TEMP_REGISTRY_BASE, 'init-idempotent', 'stable');
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'src', 'config.env.ts'), 'export const x = 1;\n');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'stable' }));

    cli(['local', 'init', '--noConfirm', '--no-patch'], { cwd: project, env });
    const slot1 = JSON.parse(readFileSync(registryFile, 'utf8')).projects['stable'].slot;
    cli(['local', 'init', '--noConfirm', '--no-patch'], { cwd: project, env });
    const slot2 = JSON.parse(readFileSync(registryFile, 'utf8')).projects['stable'].slot;
    expect(slot1).toBe(slot2);
  });

  test('applies patches when --patch is passed', () => {
    const { env } = setupTempRegistry('init-patch');
    const project = join(TEMP_REGISTRY_BASE, 'init-patch', 'legacy-api');
    mkdirSync(join(project, 'src'), { recursive: true });
    const cfgFile = join(project, 'src', 'config.env.ts');
    writeFileSync(cfgFile, '  permissions: true,\n  port: 3000,\n  sha256: true,\n');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'legacy-api' }));

    cli(['local', 'init', '--noConfirm', '--patch'], { cwd: project, env });

    const after = readFileSync(cfgFile, 'utf8');
    expect(after).toContain('Number(process.env.PORT) || 3000');
  });

  test('injects port block into existing CLAUDE.md', () => {
    const { env } = setupTempRegistry('init-claude-md');
    const project = join(TEMP_REGISTRY_BASE, 'init-claude-md', 'with-claude');
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'src', 'config.env.ts'), 'export const x = 1;\n');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'with-claude' }));
    const claude = join(project, 'CLAUDE.md');
    writeFileSync(claude, '# with-claude\n\nIntro paragraph.\n');

    cli(['local', 'init', '--noConfirm', '--no-patch'], { cwd: project, env });

    const after = readFileSync(claude, 'utf8');
    expect(after).toContain('# with-claude'); // existing content preserved
    expect(after).toContain('lt-local:port-block:start');
    expect(after).toContain('lt local up');
  });
});

describe('lt local status', () => {
  afterAll(() => cleanupTempRegistry());

  test('warns when project is not registered', () => {
    const { env } = setupTempRegistry('status-unregistered');
    const project = join(TEMP_REGISTRY_BASE, 'status-unregistered', 'never-init');
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'src', 'config.env.ts'), 'export const x = 1;\n');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'never-init' }));

    const output = cli(['local', 'status'], { cwd: project, env });
    expect(output.toLowerCase()).toContain('not registered');
  });
});

describe('lt local down', () => {
  afterAll(() => cleanupTempRegistry());

  test('reports nothing-to-stop when no state file exists', () => {
    const { env } = setupTempRegistry('down-empty');
    const project = join(TEMP_REGISTRY_BASE, 'down-empty', 'no-state');
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'src', 'config.env.ts'), 'export const x = 1;\n');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'no-state' }));

    const output = cli(['local', 'down'], { cwd: project, env });
    expect(output.toLowerCase()).toMatch(/no running processes|nothing to stop/);
  });
});
