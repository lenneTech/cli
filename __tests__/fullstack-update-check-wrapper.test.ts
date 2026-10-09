/**
 * `lt fullstack update` installs the bundled check wrapper — lt-monorepo's ROOT
 * wrapper — only at a workspace root.
 *
 * Regression: run from `projects/api` (or in a standalone API project), the
 * command handed its cwd to `healCheckWrapper`. The starter ships its own,
 * unmarked `scripts/check.mjs`, heal reads "unmarked" as "legacy", and replaced
 * the API's check with the root wrapper. The starter's own tests then failed on
 * the file's content ("no SHARED-WITH-CHECK-MJS block"), so the project's
 * `check` went red. `scripts/test-vendor-init.sh` step 9 hit exactly this.
 *
 * Behavioural on purpose: `bin/lt` runs the TypeScript source through ts-node,
 * so this exercises the real command, not a predicate copied out of it.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BIN = join(__dirname, '..', 'bin', 'lt');
const BUNDLED = readFileSync(join(__dirname, '..', 'src', 'templates', 'check', 'check.mjs'), 'utf8');
const STARTER_WRAPPER = '#!/usr/bin/env node\n// starter wrapper — SHARED-WITH-CHECK-MJS\n';

/** The hook variables git exports in a linked worktree must not reach the child. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
  return env;
}

function runUpdate(cwd: string): void {
  const result = spawnSync(process.execPath, [BIN, 'fullstack', 'update'], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(),
    timeout: 120_000,
  });
  if (result.error) throw result.error;
}

/** A project with its own (starter-shaped, unmarked) check wrapper. */
function writeSubProject(dir: string): void {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'api', scripts: { check: 'node scripts/check.mjs' } }, null, 2)}\n`);
  writeFileSync(join(dir, 'scripts', 'check.mjs'), STARTER_WRAPPER);
}

describe('lt fullstack update — check wrapper scope', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lt-update-wrapper-'));
  });

  afterEach(() => {
    rmSync(tmp, { force: true, recursive: true });
  });

  test("leaves a standalone API project's own wrapper alone", () => {
    writeSubProject(tmp);
    const pkgBefore = readFileSync(join(tmp, 'package.json'), 'utf8');

    runUpdate(tmp);

    expect(readFileSync(join(tmp, 'scripts', 'check.mjs'), 'utf8')).toBe(STARTER_WRAPPER);
    expect(readFileSync(join(tmp, 'package.json'), 'utf8')).toBe(pkgBefore);
  }, 180_000);

  test('leaves projects/api alone when run from inside it', () => {
    writeFileSync(join(tmp, 'package.json'), `${JSON.stringify({ name: 'ws', scripts: { check: 'pnpm -r run check' } }, null, 2)}\n`);
    const api = join(tmp, 'projects', 'api');
    writeSubProject(api);

    runUpdate(api);

    expect(readFileSync(join(api, 'scripts', 'check.mjs'), 'utf8')).toBe(STARTER_WRAPPER);
  }, 180_000);

  test('still installs the root wrapper at the workspace root', () => {
    writeFileSync(join(tmp, 'package.json'), `${JSON.stringify({ name: 'ws', scripts: { check: 'pnpm -r run check' } }, null, 2)}\n`);
    writeSubProject(join(tmp, 'projects', 'api'));

    runUpdate(tmp);

    expect(readFileSync(join(tmp, 'scripts', 'check.mjs'), 'utf8')).toBe(BUNDLED);
    expect(JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')).scripts.check).toBe('node scripts/check.mjs');
    // …and the sub-project it walked into keeps its own.
    expect(readFileSync(join(tmp, 'projects', 'api', 'scripts', 'check.mjs'), 'utf8')).toBe(STARTER_WRAPPER);
  }, 180_000);
});
