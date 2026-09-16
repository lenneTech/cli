/**
 * The `migrate:<env>:up` scripts a generated project deploys with.
 *
 * They run in a PRODUCTION tree — installed with `pnpm install --prod`, or as the
 * image's `pnpm deploy --prod` output — where `ts-node` is absent, because it is a
 * devDependency. Pointed at the TypeScript sources with `--compiler ts:…`, they die
 * there with `Error: ts-node is required to run migrations from TypeScript sources`
 * (measured on a generated project, 2026-09-16).
 *
 * So the deployed scripts use the COMPILED migrations under `dist/`, exactly as
 * `docker-entrypoint.sh` already invokes them:
 *
 *   <invocation> up --store ./dist/migrations-utils/migrate.js --migrations-dir ./dist/migrations
 *
 * `migrate:up` / `:down` / `:list` keep the `--compiler ts:…` form: those are the
 * developer path, run against the sources in a full install.
 *
 * Consequence to document wherever these scripts are described: they REQUIRE a build.
 * Without one there are no compiled migrations, and the run reports "no migrations"
 * instead of falling back to the sources.
 */
import { withCrossEnv } from './cross-env';

/** Script suffix → `NODE_ENV` value. `prod` maps to `production`, the name Nest config keys off. */
export const MIGRATE_ENVIRONMENTS: [string, string][] = [
  ['develop', 'develop'],
  ['test', 'test'],
  ['preview', 'preview'],
  ['prod', 'production'],
];

/** Where the build puts the compiled migrations and the store helper. */
export const COMPILED_MIGRATE_ARGS = '--store ./dist/migrations-utils/migrate.js --migrations-dir ./dist/migrations';

/**
 * Build the four deployed migrate scripts.
 *
 * @param invocation How this project starts the migrate CLI: `'migrate'` in npm mode
 *                   (the binary of `@lenne.tech/nest-server`, a production dependency),
 *                   `'node ./dist/bin/migrate.js'` in vendor mode (the shim `copy:bin`
 *                   ships into `dist/`).
 */
export function deployedMigrateScripts(invocation: string): Record<string, string> {
  const scripts: Record<string, string> = {};
  for (const [scriptEnv, nodeEnv] of MIGRATE_ENVIRONMENTS) {
    scripts[`migrate:${scriptEnv}:up`] = withCrossEnv(
      { NODE_ENV: nodeEnv },
      `${invocation} up ${COMPILED_MIGRATE_ARGS}`,
    );
  }
  return scripts;
}
