import { bareEnvPrefixes } from '../src/lib/cross-env';
import { deployedMigrateScripts, MIGRATE_ENVIRONMENTS } from '../src/lib/migrate-scripts';

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

  it('uses the invocation the mode provides', () => {
    expect(npm['migrate:prod:up']).toBe(
      'cross-env NODE_ENV=production migrate up --store ./dist/migrations-utils/migrate.js --migrations-dir ./dist/migrations',
    );
    expect(vendor['migrate:develop:up']).toBe(
      'cross-env NODE_ENV=develop node ./dist/bin/migrate.js up --store ./dist/migrations-utils/migrate.js --migrations-dir ./dist/migrations',
    );
  });

  it('keeps the env out of a bare POSIX prefix', () => {
    for (const script of Object.values(vendor)) {
      expect(bareEnvPrefixes(script)).toEqual([]);
    }
  });
});
