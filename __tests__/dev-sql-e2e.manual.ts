/**
 * `lt dev`'s SQL databases against REAL servers: PostgreSQL, MySQL 8.4 and MariaDB 11.8, with the
 * owner / application role split nest-server 12.1 requires. Manual (see CLAUDE.md, "Manual tests"):
 * it needs running servers and the `pg` / `mysql2` drivers, so `npm test` never collects it.
 *
 * Setup (throwaway containers, ports clear of a developer's own servers):
 *
 *   docker run -d --rm --name lt-cli-sqltest-pg -e POSTGRES_USER=lt_admin -e POSTGRES_PASSWORD=admin-secret \
 *     -p 127.0.0.1:55432:5432 postgres:18
 *   docker run -d --rm --name lt-cli-sqltest-mysql -e MYSQL_ROOT_PASSWORD=root-secret -p 127.0.0.1:53306:3306 mysql:8.4
 *   docker run -d --rm --name lt-cli-sqltest-mariadb -e MARIADB_ROOT_PASSWORD=root-secret -p 127.0.0.1:53307:3306 mariadb:11.8
 *
 *   PostgreSQL (one statement per psql -c; CREATE DATABASE cannot run in a transaction):
 *     CREATE ROLE shop_owner LOGIN PASSWORD 'owner-secret' CREATEDB NOSUPERUSER
 *     CREATE ROLE shop_app LOGIN PASSWORD 'app-secret' NOSUPERUSER NOBYPASSRLS NOCREATEDB
 *     CREATE ROLE shop_nocreate LOGIN PASSWORD 'nc-secret' NOSUPERUSER NOCREATEDB
 *     CREATE DATABASE shop OWNER shop_owner
 *   MySQL and MariaDB, as root:
 *     CREATE USER 'shop_owner'@'%' IDENTIFIED BY 'owner-secret';
 *     GRANT ALL PRIVILEGES ON `shop%`.* TO 'shop_owner'@'%' WITH GRANT OPTION;
 *     CREATE USER 'shop_app'@'%' IDENTIFIED BY 'app-secret';
 *     CREATE DATABASE shop; GRANT SELECT, INSERT, UPDATE, DELETE ON shop.* TO 'shop_app'@'%';
 *
 * Run: LT_SQL_E2E_DRIVER_DIR=<a dir whose node_modules has pg and mysql2, e.g. a nest-server checkout> \
 *        npx vitest run --config vitest.manual.config.mts __tests__/dev-sql-e2e.manual.ts
 * Without LT_SQL_E2E_DRIVER_DIR the suite skips itself. Remove the containers afterwards.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  describeSqlFailure,
  dropSqlDatabases,
  ensureSqlDatabase,
  listSqlDatabaseNames,
  localSqlSource,
  planStackDatabases,
  SqlSource,
  StackSqlDatabase,
} from '../src/lib/dev-sql';

const DRIVER_DIR = process.env.LT_SQL_E2E_DRIVER_DIR;
const SERVERS = [
  { port: Number(process.env.LT_SQL_E2E_POSTGRES_PORT || 55432), scheme: 'postgres' },
  { port: Number(process.env.LT_SQL_E2E_MYSQL_PORT || 53306), scheme: 'mysql' },
  { port: Number(process.env.LT_SQL_E2E_MARIADB_PORT || 53307), scheme: 'mariadb' },
] as const;

/** Connect as the APPLICATION role to `db` and run one query — what nest-server does at boot. */
async function appCanUse(scheme: string, port: number, db: string): Promise<boolean> {
  const load = (name: string) => require(require.resolve(name, { paths: [DRIVER_DIR as string] }));
  try {
    if (scheme === 'postgres') {
      const { Client } = load('pg');
      const client = new Client({ connectionString: `postgres://shop_app:app-secret@127.0.0.1:${port}/${db}` });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
    } else {
      const mysql = load('mysql2/promise');
      const connection = await mysql.createConnection({
        database: db,
        host: '127.0.0.1',
        password: 'app-secret',
        port,
        user: 'shop_app',
      });
      await connection.query('SELECT 1');
      await connection.end();
    }
    return true;
  } catch {
    return false;
  }
}

describe.runIf(Boolean(DRIVER_DIR))('dev-sql against real servers', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-dev-sql-e2e-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  for (const { port, scheme } of SERVERS) {
    test(`${scheme}: create, use, list and remove a ticket database; the configured one survives`, async () => {
      const api = join(dir, 'api');
      mkdirSync(join(api, 'src'), { recursive: true });
      writeFileSync(
        join(api, '.env'),
        `NSC__DATABASE__URL=${scheme}://shop_app:app-secret@127.0.0.1:${port}/shop\n` +
          `NSC__DATABASE__OWNER_URL=${scheme}://shop_owner:owner-secret@127.0.0.1:${port}/shop\n`,
      );
      const drivers = [DRIVER_DIR];

      const ticket = planStackDatabases({ apiDir: api, dbName: 'shop-2314', keepConfiguredSqlDb: false });
      expect(ticket.sqlProblem).toBeNull();
      const db = ticket.sql as StackSqlDatabase;

      const created = ensureSqlDatabase(db, drivers);
      expect(created.failure).toBeNull();
      expect(created.warning).toBeUndefined();
      expect(created.created).toBe(true);
      expect(ensureSqlDatabase(db, drivers)).toEqual({ created: false, failure: null });
      // The application role reaches the new database before nest-server created a single table:
      // CONNECT on PostgreSQL, the database-level row grant on MySQL / MariaDB
      expect(await appCanUse(scheme, port, 'shop-2314')).toBe(true);

      const source = localSqlSource(api, {}) as SqlSource;
      expect(listSqlDatabaseNames(source, drivers)).toEqual(expect.arrayContaining(['shop', 'shop-2314']));

      // Runs as the owner role, so it also proves the database was created owned by it (PostgreSQL lets
      // only the owner or a superuser drop a database)
      expect(dropSqlDatabases(source, ['shop-2314'], drivers)).toEqual({ dropped: ['shop-2314'], failure: null });
      expect(listSqlDatabaseNames(source, drivers)).not.toContain('shop-2314');

      // the configured database is refused at the irreversible step itself
      expect(dropSqlDatabases(source, ['shop'], drivers).failure?.message).toMatch(/configuration names/);
      expect(listSqlDatabaseNames(source, drivers)).toContain('shop');
    });

    test(`${scheme}: a wrong password reads as auth, a dead port as unreachable`, () => {
      const base = {
        configuredName: 'shop',
        driver: scheme === 'postgres' ? 'postgres' : scheme,
        name: 'shop-x',
      } as const;
      const wrong: StackSqlDatabase = {
        ...base,
        display: `${scheme}://127.0.0.1:${port}/shop-x`,
        url: `${scheme}://shop_owner:nope@127.0.0.1:${port}/shop-x`,
      };
      expect(ensureSqlDatabase(wrong, [DRIVER_DIR]).failure?.reason).toBe('auth');

      const dead: StackSqlDatabase = {
        ...base,
        display: `${scheme}://127.0.0.1:1/shop-x`,
        url: `${scheme}://shop_owner:owner-secret@127.0.0.1:1/shop-x`,
      };
      expect(ensureSqlDatabase(dead, [DRIVER_DIR]).failure?.reason).toBe('unreachable');
    });
  }

  test('postgres: an owner without CREATEDB is told how to fix it', () => {
    const db: StackSqlDatabase = {
      configuredName: 'shop',
      display: 'postgres://127.0.0.1:55432/shop-y',
      driver: 'postgres',
      name: 'shop-y',
      url: 'postgres://shop_nocreate:nc-secret@127.0.0.1:55432/shop-y',
    };
    const { failure } = ensureSqlDatabase(db, [DRIVER_DIR]);
    expect(failure?.reason).toBe('denied');
    expect(describeSqlFailure(failure!, db)).toMatch(/CREATEDB/);
  });
});
