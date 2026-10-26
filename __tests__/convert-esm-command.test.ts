/**
 * The refusals of `lt server convert-esm`, run end to end through `bin/lt`. Each one guards a
 * conversion that rewrites and deletes project files: a misspelt flag must not run the real thing
 * (`--dry-ru --noConfirm`), an 11.x framework would lose its loader, and a dirty tree would mix
 * the conversion into uncommitted work that can then no longer be reverted on its own. Without
 * these tests, any of the three guards could be removed with the suite staying green (review,
 * 2026-10-26).
 */
import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const LT = join(__dirname, '..', 'bin', 'lt');

/** Git variables a hook would export; a test repository must never inherit them. */
const cleanEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE)$/.test(key)));

function apiProject(nestServerVersion: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-convert-esm-'));
  const files: Record<string, string> = {
    'node_modules/@lenne.tech/nest-server/package.json': JSON.stringify({ version: nestServerVersion }),
    'package.json': JSON.stringify({ name: 'api', scripts: { 'start:nodemon': 'ts-node src/main.ts' } }, null, 2),
    'src/main.ts': "import { x } from './x';\nexport const y = x;\n",
    'src/x.ts': 'export const x = 1;\n',
    'tsconfig.json': '{ "compilerOptions": { "module": "commonjs" } }\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { env: cleanEnv(), stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'baseline');
  return dir;
}

function run(dir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [LT, 'server', 'convert-esm', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: cleanEnv(),
    timeout: 120000,
  });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

const status = (dir: string) =>
  execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8', env: cleanEnv() });

describe('lt server convert-esm refusals', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { force: true, recursive: true }));

  test('a misspelt flag exits 1 before anything is touched', () => {
    dir = apiProject('12.0.0');
    const { output, status: code } = run(dir, '--dry-ru', '--noConfirm', '--skip-verify');
    expect(code).toBe(1);
    expect(output).toContain('--dry-ru');
    expect(status(dir)).toBe('');
  });

  test('an installed nest-server 11 is refused: the conversion would cost the project its loader', () => {
    dir = apiProject('11.43.3');
    const { output, status: code } = run(dir, '--noConfirm', '--skip-verify');
    expect(code).toBe(1);
    expect(output).toContain('ES modules need 12 or newer');
    expect(status(dir)).toBe('');
  });

  test('a dirty working tree is refused, and the uncommitted work stays exactly as it was', () => {
    dir = apiProject('12.0.0');
    writeFileSync(join(dir, 'src/x.ts'), 'export const x = 2; // work in progress\n');
    const before = status(dir);

    const { output, status: code } = run(dir, '--noConfirm', '--skip-verify');

    expect(code).toBe(1);
    expect(output).toContain('uncommitted changes');
    expect(status(dir)).toBe(before);
    expect(readFileSync(join(dir, 'src/x.ts'), 'utf8')).toBe('export const x = 2; // work in progress\n');
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).type).toBeUndefined();
  });

  test('a clean nest-server 12 project is converted (the refusals above are not refusing everything)', () => {
    dir = apiProject('12.0.0');
    const { status: code } = run(dir, '--noConfirm', '--skip-verify');
    // Exit 1 is expected here: the stub package cannot be imported, which the named-import check reports.
    expect([0, 1]).toContain(code);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).type).toBe('module');
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toContain("from './x.js'");
  });
});
