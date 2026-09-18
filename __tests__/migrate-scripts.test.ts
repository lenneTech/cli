import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { bareEnvPrefixes } from '../src/lib/cross-env';
import {
  BUILD_GUARD_FILE,
  deployedMigrateScripts,
  MIGRATE_ENVIRONMENTS,
  missingBuildGuardWarning,
} from '../src/lib/migrate-scripts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filesystem } = require('gluegun');

/**
 * The deployed `migrate:<env>:up` scripts run in a production tree — `pnpm install --prod`
 * or the image's `pnpm deploy --prod` — where `ts-node` is absent because it is a
 * devDependency. Pointed at the TypeScript sources they die there with
 * `Error: ts-node is required to run migrations from TypeScript sources` (measured in a
 * generated project, 2026-09-16). So they run the compiled migrations under `dist/`,
 * the same invocation `docker-entrypoint.sh` uses.
 */
describe('deployedMigrateScripts', () => {
  const npm = deployedMigrateScripts('migrate');
  const vendor = deployedMigrateScripts('node ./dist/bin/migrate.js');

  it('covers exactly the four deployed environments', () => {
    expect(Object.keys(npm)).toEqual([
      'migrate:develop:up',
      'migrate:test:up',
      'migrate:preview:up',
      'migrate:prod:up',
    ]);
    expect(MIGRATE_ENVIRONMENTS.map(([, nodeEnv]) => nodeEnv)).toEqual(['develop', 'test', 'preview', 'production']);
  });

  it('runs the compiled migrations, never the sources', () => {
    for (const script of [...Object.values(npm), ...Object.values(vendor)]) {
      expect(script).toContain('--store ./dist/migrations-utils/migrate.js');
      expect(script).toContain('--migrations-dir ./dist/migrations');
      // `--compiler ts:…` would need ts-node, which a production tree does not have.
      expect(script).not.toContain('--compiler');
      expect(script).not.toContain('./migrations-utils/migrate.js');
    }
  });

  it('matches the form nest-server-starter writes, character for character', () => {
    // A cloned starter and a generated project must migrate the same way; the only
    // deliberate difference is the invocation, which follows docker-entrypoint.sh
    // (npm mode: the `migrate` binary, vendor mode: the shim in dist/bin).
    expect(npm['migrate:prod:up']).toBe(
      'node scripts/require-built-migrations.mjs && cross-env NODE_ENV=production migrate up --store ./dist/migrations-utils/migrate.js --migrations-dir ./dist/migrations',
    );
    expect(vendor['migrate:develop:up']).toBe(
      'node scripts/require-built-migrations.mjs && cross-env NODE_ENV=develop node ./dist/bin/migrate.js up --store ./dist/migrations-utils/migrate.js --migrations-dir ./dist/migrations',
    );
  });

  it('guards every deployed script, so the chain fails before migrate starts', () => {
    for (const script of [...Object.values(npm), ...Object.values(vendor)]) {
      expect(script.startsWith(`node scripts/${BUILD_GUARD_FILE} && `)).toBe(true);
    }
  });

  it('keeps the env out of a bare POSIX prefix', () => {
    for (const script of Object.values(vendor)) {
      expect(bareEnvPrefixes(script)).toEqual([]);
    }
  });
});

describe('missingBuildGuardWarning', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lt-migrate-guard-'));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('is quiet when the starter brought the guard along', () => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', BUILD_GUARD_FILE), '// guard\n');
    expect(missingBuildGuardWarning(filesystem, root)).toBeNull();
  });

  it('warns when it is absent — every deployed script would die at the first &&', () => {
    // The CLI ships no copy of its own on purpose: the file belongs to
    // nest-server-starter, which both modes clone as their base. This warning is what
    // catches the day that assumption stops holding.
    const warning = missingBuildGuardWarning(filesystem, root);
    expect(warning).toContain(BUILD_GUARD_FILE);
    expect(warning).toContain('nest-server-starter');
  });
});
