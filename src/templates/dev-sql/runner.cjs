/**
 * Creates, lists and drops the databases `lt dev` gives each stack of a project that runs on
 * PostgreSQL / MySQL / MariaDB (nest-server 12.1+). Started by `src/lib/dev-sql.ts` as
 * `node runner.cjs`, never imported.
 *
 * Every value arrives through the environment, nothing is interpolated into this file or into SQL
 * text: identifiers are quoted here (and validated by the caller before), account names and values
 * travel as driver parameters. The driver is the PROJECT's own `pg` / `mysql2`, resolved by the
 * caller, so the CLI needs no database dependency of its own.
 *
 *   LT_SQL_DRIVER_PATH  resolved path of `pg` or `mysql2/promise`
 *   LT_SQL_KIND         postgres | mysql
 *   LT_SQL_ACTION       ensure | list | drop
 *   LT_SQL_ADMIN_URL    owner URL (or the application URL when the project configures no owner)
 *   LT_SQL_APP_URL      application URL — its account gets access to a database created here
 *   LT_SQL_DB           ensure: the database
 *   LT_SQL_DBS          drop: JSON array of databases
 *   LT_SQL_FALLBACK_DB  postgres: a database the admin can surely connect to (the configured one)
 *
 * Prints exactly one JSON line and exits 0; anything else on stdout means the runner itself broke.
 */
'use strict';

const env = process.env;
const UNREACHABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT']);

function reply(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function failure(error, extra) {
  const code = error && error.code;
  const message = String((error && error.message) || error).split('\n')[0];
  let reason = 'failed';
  if (UNREACHABLE.has(code) || /timeout|timed out|terminated unexpectedly/i.test(message)) reason = 'unreachable';
  // PostgreSQL: 28P01 wrong password, 28000 no pg_hba entry; MySQL: wrong account or password
  else if (code === '28P01' || code === '28000' || code === 'ER_ACCESS_DENIED_ERROR') reason = 'auth';
  // PostgreSQL: missing privilege (CREATEDB, CONNECT); MySQL: database / global privilege missing
  else if (
    code === '42501' ||
    code === 'ER_DBACCESS_DENIED_ERROR' ||
    code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR' ||
    code === 'ER_TABLEACCESS_DENIED_ERROR'
  )
    reason = 'denied';
  return Object.assign({ message, ok: false, reason }, extra);
}

/** The URL with its database (path) replaced; scheme, credentials, host and query stay as they are. */
function withDatabase(url, db) {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url)[0];
  const rest = url.slice(scheme.length);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const tail = authorityEnd === -1 ? '' : rest.slice(authorityEnd);
  const queryStart = tail.search(/[?#]/);
  const query = queryStart === -1 ? '' : tail.slice(queryStart);
  return `${scheme}${authority}/${encodeURIComponent(db)}${query}`;
}

function userOf(url) {
  try {
    return decodeURIComponent(new URL(url).username) || null;
  } catch {
    return null;
  }
}

// ── PostgreSQL ──────────────────────────────────────────────────────────────

function pgIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** A session on a database that always exists, since CREATE / DROP DATABASE cannot run inside the target. */
async function pgAdmin(pg) {
  const candidates = ['postgres', 'template1', env.LT_SQL_FALLBACK_DB].filter(Boolean);
  let last;
  for (const db of candidates) {
    const client = new pg.Client({ connectionString: withDatabase(env.LT_SQL_ADMIN_URL, db), connectionTimeoutMillis: 8000 });
    try {
      await client.connect();
      return client;
    } catch (error) {
      last = error;
      await client.end().catch(() => undefined);
      // 3D000: no such database, 42501: no CONNECT on it — try the next one; anything else is final
      if (error.code !== '3D000' && error.code !== '42501') throw error;
    }
  }
  throw last;
}

async function postgres(pg) {
  const client = await pgAdmin(pg);
  try {
    if (env.LT_SQL_ACTION === 'list') {
      const { rows } = await client.query('SELECT datname FROM pg_database WHERE NOT datistemplate');
      return { names: rows.map((row) => row.datname), ok: true };
    }
    if (env.LT_SQL_ACTION === 'drop') {
      const dropped = [];
      for (const db of JSON.parse(env.LT_SQL_DBS || '[]')) {
        try {
          // FORCE ends the sessions a stopped stack may have left behind (PostgreSQL 13+; nest-server needs 15+)
          await client.query(`DROP DATABASE IF EXISTS ${pgIdent(db)} WITH (FORCE)`);
        } catch (error) {
          return failure(error, { dropped });
        }
        dropped.push(db);
      }
      return { dropped, ok: true };
    }

    const db = env.LT_SQL_DB;
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
    let created = false;
    if (rowCount === 0) {
      try {
        // Created by the admin (owner) role, so that role owns it, as nest-server's schema runner expects
        await client.query(`CREATE DATABASE ${pgIdent(db)}`);
        created = true;
      } catch (error) {
        // 42P04: a parallel start created it first
        if (error.code !== '42P04') throw error;
      }
    }
    let warning;
    const appUser = userOf(env.LT_SQL_APP_URL);
    if (created && appUser && appUser !== client.user) {
      try {
        await client.query(`GRANT CONNECT ON DATABASE ${pgIdent(db)} TO ${pgIdent(appUser)}`);
      } catch (error) {
        warning = `could not grant CONNECT on "${db}" to "${appUser}": ${String(error.message).split('\n')[0]}`;
      }
    }
    return { created, ok: true, warning };
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ── MySQL / MariaDB ─────────────────────────────────────────────────────────

function mysqlOptions(url) {
  const parsed = new URL(url);
  return {
    connectTimeout: 8000,
    host: decodeURIComponent(parsed.hostname).replace(/^\[|\]$/g, '') || 'localhost',
    password: decodeURIComponent(parsed.password),
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
  };
}

/** The account the application URL logs in as (`'user'@'host'`), as MySQL matched it. */
async function mysqlAppAccount(mysql) {
  if (!env.LT_SQL_APP_URL || env.LT_SQL_APP_URL === env.LT_SQL_ADMIN_URL) return null;
  const app = await mysql.createConnection(mysqlOptions(env.LT_SQL_APP_URL));
  try {
    const [rows] = await app.query('SELECT CURRENT_USER() AS account');
    const account = String(rows[0].account);
    const at = account.lastIndexOf('@');
    return { host: account.slice(at + 1), user: account.slice(0, at) };
  } finally {
    await app.end().catch(() => undefined);
  }
}

async function mysql(driver) {
  const admin = await driver.createConnection(mysqlOptions(env.LT_SQL_ADMIN_URL));
  try {
    if (env.LT_SQL_ACTION === 'list') {
      const [rows] = await admin.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA');
      return { names: rows.map((row) => row.name), ok: true };
    }
    if (env.LT_SQL_ACTION === 'drop') {
      const account = await mysqlAppAccount(driver).catch(() => null);
      const dropped = [];
      for (const db of JSON.parse(env.LT_SQL_DBS || '[]')) {
        try {
          // A database-level grant outlives its database; withdrawn first, it cannot pile up across tickets
          if (account) {
            await admin.query('REVOKE ALL PRIVILEGES ON ??.* FROM ?@?', [db, account.user, account.host]).catch(() => undefined);
          }
          await admin.query('DROP DATABASE IF EXISTS ??', [db]);
        } catch (error) {
          return failure(error, { dropped });
        }
        dropped.push(db);
      }
      return { dropped, ok: true };
    }

    const db = env.LT_SQL_DB;
    const [existing] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [db]);
    if (existing.length > 0) return { created: false, ok: true };
    // nest-server's collation; it would switch the default itself while Better-Auth creates its tables
    await admin.query('CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', [db]);
    let warning;
    try {
      const account = await mysqlAppAccount(driver);
      // Rows only — nest-server refuses an application account that may alter, drop, index or grant
      if (account) await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ??.* TO ?@?', [db, account.user, account.host]);
    } catch (error) {
      warning = `could not grant the application account access to \`${db}\`: ${String(error.message).split('\n')[0]}`;
    }
    return { created: true, ok: true, warning };
  } finally {
    await admin.end().catch(() => undefined);
  }
}

(async () => {
  try {
    const driver = require(env.LT_SQL_DRIVER_PATH);
    reply(env.LT_SQL_KIND === 'postgres' ? await postgres(driver) : await mysql(driver));
  } catch (error) {
    reply(failure(error));
  }
  process.exit(0);
})();
