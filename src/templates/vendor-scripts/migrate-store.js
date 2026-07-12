// Migration store. Loaded by the migrate CLI via `--store`.
//
// Runs from two layouts:
//   - Repo:  migrations-utils/migrate.js  → vendored core is TypeScript-only, so
//            ts-node has to be registered before requiring any vendor module.
//   - Image: dist/migrations-utils/migrate.js → everything next to it is compiled
//            JS and ts-node is NOT installed. Requiring it would crash the
//            entrypoint (`set -e`) before the server ever starts.
//
// So probe for the compiled helper first and only fall back to ts-node.
const HELPER = '../src/core/modules/migrate/helpers/migration.helper';

try {
  require.resolve(`${HELPER}.js`);
} catch {
  require('./ts-compiler');
}

const { createMigrationStore } = require(HELPER);
const { resolveMongoUri } = require('./mongo-uri');

module.exports = createMigrationStore(
  resolveMongoUri(),
  'migrations', // optional, default is 'migrations'
);
