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
import type { GluegunFilesystem } from 'gluegun';

import { join } from 'path';

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
 * Build guard in front of every deployed script — the same wiring nest-server-starter
 * uses (`node scripts/… && <migrate>`), so the chain fails BEFORE migrate starts and
 * `dp:prod` never reaches the server start.
 *
 * It is needed because the failure is otherwise SILENT: measured with nest-server
 * 11.41.2, a missing migrations directory prints "treating as empty" and a missing or
 * empty one both end in "No pending migrations", exit 0. An unbuilt checkout would
 * report a successful migration run that never happened, and the server would then come
 * up against an unmigrated database.
 */
export const BUILD_GUARD_FILE = 'require-built-migrations.mjs';
const BUILD_GUARD = `node scripts/${BUILD_GUARD_FILE} && `;

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
    scripts[`migrate:${scriptEnv}:up`] =
      BUILD_GUARD + withCrossEnv({ NODE_ENV: nodeEnv }, `${invocation} up ${COMPILED_MIGRATE_ARGS}`);
  }
  return scripts;
}

/**
 * Warn when the build guard the deployed scripts call is not in the project.
 *
 * The file ships with nest-server-starter, which BOTH modes clone as their base
 * (`server.ts`: "Both npm and vendor mode clone nest-server-starter as the base"), and
 * nothing in the conversion prunes `scripts/` wholesale — only
 * `strip-api-mode-markers.mjs`, `scripts/vendor/` and, in REST mode,
 * `run-spectaql.mjs`. So the CLI does NOT ship its own copy: a second, nearly identical
 * file is exactly the drift we are trying to avoid.
 *
 * What it does instead is fail loudly if the assumption stops holding — e.g. a project
 * built from an older starter. Same treatment as `migrations-utils/mongo-uri.js`:
 * without the file every deployed migrate script dies at the first `&&`.
 *
 * @returns A warning message, or null when the guard is present.
 */
export function missingBuildGuardWarning(filesystem: GluegunFilesystem, projectDir: string): null | string {
  if (filesystem.exists(join(projectDir, 'scripts', BUILD_GUARD_FILE))) {
    return null;
  }
  return (
    `  ⚠ scripts/${BUILD_GUARD_FILE} is missing — the deployed migrate:<env>:up scripts call it ` +
    'before migrating and would fail immediately. It ships with nest-server-starter; add it ' +
    '(or update the starter this project was created from).'
  );
}
