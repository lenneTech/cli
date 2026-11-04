/**
 * The SQL side of `lt dev`: projects on PostgreSQL / MySQL / MariaDB (nest-server 12.1+).
 *
 * nest-server reads its SQL connection from `database.url` / `database.ownerUrl` in the API's
 * `src/config.env.ts`, merged with `NSC__DATABASE__URL` / `NSC__DATABASE__OWNER_URL` from the
 * environment (and the API's `.env`, which nest-server loads itself). It never reads `DATABASE_URL`.
 * So without this module every stack of a SQL project (dev, `-test`, `-test-N`, every ticket) ran
 * against the one database its configuration names.
 *
 * What it does, per stack:
 *   1. **Detect** the project's SQL source ({@link detectDatabaseSetup}): the URL the API itself
 *      would use, in the API's own precedence (shell → `.env` → config literal). A `pg` or `mysql2`
 *      dependency alone is NOT a signal: TurboOps depends on `pg` for an unrelated database, and
 *      exporting `NSC__DATABASE__URL` there would move its framework models onto SQL.
 *   2. **Derive** the stack's URLs ({@link planStackDatabases}): the same scheme, credentials, host
 *      and query, only the database (the path) replaced by the stack's name. The base dev stack keeps
 *      the database the project configures, so a developer's data does not move.
 *   3. **Provision** it ({@link ensureSqlDatabase}): unlike MongoDB, a SQL server does not create a
 *      database on first use.
 *   4. **List / drop** for `lt ticket stop` and the orphan sweeps, behind the same name guards as
 *      MongoDB ({@link listSqlDatabaseNames}, {@link dropSqlDatabases}).
 *
 * Only a LOCAL server is ever touched, the same rule as the loopback-only `MONGO_BASE_URI`: a URL
 * pointing elsewhere is reported, never provisioned, never dropped.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** What one stack runs on. */
export interface DatabaseSetup {
  /** The API (also) uses MongoDB, so `NSC__MONGOOSE__URI` is exported. */
  mongo: boolean;
  /** The project's SQL source, or null when it runs on MongoDB only or {@link sqlProblem} is set. */
  sql: null | SqlSource;
  /** The project runs on SQL, but `lt dev` cannot give its stacks their own database (sql is null then). */
  sqlProblem: null | string;
}

export type SqlDriver = 'mariadb' | 'mysql' | 'postgres';

/** Outcome of {@link ensureSqlDatabase}. */
export interface SqlEnsureResult {
  created: boolean;
  /** Set when the database could not be made available; the API must not start then. */
  failure: null | SqlFailure;
  /** Something the user should know, without stopping the start (e.g. a grant that failed). */
  warning?: string;
}

/** A runner call that failed. */
export interface SqlFailure {
  message: string;
  reason: SqlFailureReason;
}

/** Why a runner call did not succeed — each needs a different fix from the user. */
export type SqlFailureReason = 'auth' | 'denied' | 'failed' | 'no-driver' | 'unreachable';

/** The SQL connection as the PROJECT configures it. */
export interface SqlSource {
  driver: SqlDriver;
  /** Where the URL came from, for messages (`NSC__DATABASE__URL in projects/api/.env`). */
  origin: string;
  /** Owner role: creates and evolves the schema. Absent when the project configures none. */
  ownerUrl?: string;
  /** Application role. */
  url: string;
}

/** The databases one stack uses, ready for `buildDevEnv` and the `db:` lines. */
export interface StackDatabases {
  /** Credential-free URLs, for the terminal and the registry. */
  displayUrls: string[];
  mongo: boolean;
  /** This stack's own SQL database, or null (MongoDB only, or {@link sqlProblem}). */
  sql: null | StackSqlDatabase;
  /** Set when the project runs on SQL and this stack cannot get its own database. */
  sqlProblem: null | string;
}

/** One stack's SQL database. */
export interface StackSqlDatabase {
  /** The database the project configures (fallback admin database for PostgreSQL). */
  configuredName: null | string;
  /** `postgres://127.0.0.1:5432/<name>` — no credentials, no query. */
  display: string;
  driver: SqlDriver;
  name: string;
  ownerUrl?: string;
  url: string;
}

/** PostgreSQL truncates identifiers at 63 bytes (MySQL: 64 characters) — silently, so two stacks could share one. */
export const SQL_DB_NAME_MAX = 63;

const SQL_SCHEMES: Record<string, SqlDriver> = {
  'mariadb:': 'mariadb',
  'mysql:': 'mysql',
  'postgres:': 'postgres',
  'postgresql:': 'postgres',
};

const SQL_DRIVER_LABEL: Record<SqlDriver, string> = { mariadb: 'MariaDB', mysql: 'MySQL', postgres: 'PostgreSQL' };

/** Stands in for a `${…}` substitution of a template literal read from config.env.ts. */
const PLACEHOLDER = '\u0000';

/** Upper bound for one runner call: a server that accepts TCP but never answers must not hang `lt dev up`. */
const RUNNER_TIMEOUT_MS = 20_000;

interface ConfigUrl {
  /** Under a property named `local` (the environment `lt dev` runs the API in). */
  local: boolean;
  /** The literal's text; a `${…}` substitution reads as {@link PLACEHOLDER}. */
  text: string;
}

/** One sentence that says what failed and what to do about it. */
export function describeSqlFailure(
  failure: SqlFailure,
  db: { display: string; driver: SqlDriver; name?: string },
): string {
  const label = SQL_DRIVER_LABEL[db.driver];
  const host = db.display.replace(/\/[^/]*$/, '');
  switch (failure.reason) {
    case 'auth':
      return `${label} at ${host} refused the login (${failure.message}) — check the user and password in the project's database URL.`;
    case 'denied':
      return db.driver === 'postgres'
        ? `${label} refused (${failure.message}). The owner role needs CREATEDB to create one database per stack: ALTER ROLE <owner> CREATEDB;`
        : `${label} refused (${failure.message}). The owner account needs CREATE and GRANT OPTION on the stack databases, e.g. GRANT ALL PRIVILEGES ON \`${(db.name ?? '<project>').replace(/-(local|dev|test)(-.*)?$/i, '')}%\`.* TO <owner> WITH GRANT OPTION;`;
    case 'no-driver':
      return `the API has no ${db.driver === 'postgres' ? '`pg`' : '`mysql2`'} package installed — run the package manager's install in the API project first.`;
    case 'unreachable':
      return `no ${label} answers at ${host} (${failure.message}) — start the local database server.`;
    default:
      return `${label} at ${host}: ${failure.message}`;
  }
}

/**
 * Read the SQL source (and whether MongoDB stays in use) from an API project.
 *
 * Each URL is resolved on its own, in the order nest-server applies them: a shell export of
 * `NSC__DATABASE__URL` / `__OWNER_URL`, then the API's `.env`, then a literal in `src/config.env.ts`.
 *
 * @param mainApiDir the main checkout's API dir when `apiDir` lies in a linked worktree
 *   (`dev-ticket.ts#mainCheckoutApiDir`). A worktree has no `.env` of its own — git does not check
 *   out ignored files — so without this a ticket stack would not see a URL kept there, and would
 *   silently run on MongoDB while the dev stack runs on SQL. A worktree's own `.env` still wins.
 */
export function detectDatabaseSetup(
  apiDir: null | string,
  baseEnv: NodeJS.ProcessEnv = {},
  mainApiDir: null | string = null,
): DatabaseSetup {
  if (!apiDir) return { mongo: true, sql: null, sqlProblem: null };

  const ownEnvFile = join(apiDir, '.env');
  const fromMain = Boolean(mainApiDir) && !existsSync(ownEnvFile);
  const dotEnv = readDotEnv(fromMain ? join(mainApiDir as string, '.env') : ownEnvFile);
  const dotEnvLabel = fromMain ? "the main checkout's API .env" : "the API's .env";
  const config = readConfigDatabase(join(apiDir, 'src', 'config.env.ts'));

  const url = pickSqlUrl('NSC__DATABASE__URL', baseEnv, dotEnv, dotEnvLabel, config.urls);
  const ownerUrl = pickSqlUrl('NSC__DATABASE__OWNER_URL', baseEnv, dotEnv, dotEnvLabel, config.ownerUrls);
  const recognised = Boolean(url.value || url.problem || ownerUrl.value || ownerUrl.problem);

  // MongoDB stays a source when the project configures `mongoose` itself (it becomes the extra
  // source `mongoose`) or sets its URI. Exporting `NSC__MONGOOSE__URI` to a project on SQL ALONE
  // would make `mongoose` explicit and open a MongoDB connection nobody configured (nest-server
  // 12.1 migration guide §5), so the export follows the project's own choice.
  const mongo =
    !recognised || config.mongoose || Boolean(baseEnv.NSC__MONGOOSE__URI) || Boolean(dotEnv.NSC__MONGOOSE__URI);

  if (!recognised) return { mongo, sql: null, sqlProblem: null };
  const problem = url.problem ?? ownerUrl.problem;
  if (problem) return { mongo, sql: null, sqlProblem: problem };
  if (!url.value) {
    return {
      mongo,
      sql: null,
      sqlProblem: `an owner URL (${ownerUrl.origin}) is configured without an application URL (NSC__DATABASE__URL / database.url)`,
    };
  }

  const driver = sqlDriverOf(url.value) as SqlDriver;
  const source: SqlSource = { driver, origin: url.origin, url: url.value };
  if (ownerUrl.value) source.ownerUrl = ownerUrl.value;
  return { mongo, sql: source, sqlProblem: null };
}

/** `postgres://127.0.0.1:5432/<db>` — scheme, host, port and database; never credentials or query options. */
export function displaySqlUrl(url: string): string {
  const parts = splitSqlUrl(url);
  if (!parts) return '<unparsable URL>';
  const host = parts.authority.slice(parts.authority.lastIndexOf('@') + 1);
  return `${parts.scheme}${host}${parts.path}`;
}

/**
 * Drop databases on the project's SQL server, stopping at the first failure (as MongoDB's
 * `dropDatabases` does: a server that is down is down for every name).
 *
 * Callers pass only names that passed the ticket / prune guards. The names are validated again
 * here, because they end up quoted inside a `DROP DATABASE` statement.
 */
export function dropSqlDatabases(
  source: SqlSource,
  names: string[],
  driverPaths: (null | string | undefined)[],
): { dropped: string[]; failure: null | SqlFailure } {
  const invalid = names.find((name) => sqlDatabaseNameProblem(name));
  if (invalid) {
    return { dropped: [], failure: { message: sqlDatabaseNameProblem(invalid) as string, reason: 'failed' } };
  }
  // Last line of defence, at the irreversible step itself (see sqlRemovalTargets)
  const { refused } = sqlRemovalTargets(source, names);
  if (refused.length > 0) {
    return {
      dropped: [],
      failure: { message: `"${refused[0]}" is the database the project's configuration names`, reason: 'failed' },
    };
  }
  if (names.length === 0) return { dropped: [], failure: null };
  const result = runSqlRunner(source, driverPaths, { LT_SQL_ACTION: 'drop', LT_SQL_DBS: JSON.stringify(names) });
  const dropped = Array.isArray(result.dropped) ? (result.dropped as string[]) : [];
  return result.ok ? { dropped, failure: null } : { dropped, failure: asFailure(result) };
}

/**
 * Create the stack's database when it does not exist yet, and give the application role access.
 *
 * Runs as the owner role, so the owner owns the database, as nest-server's schema runner expects
 * (it creates and evolves the tables at boot). PostgreSQL needs `CREATEDB` for that, MySQL a
 * global `CREATE` privilege — {@link describeSqlFailure} names the statement when it is missing.
 */
export function ensureSqlDatabase(db: StackSqlDatabase, driverPaths: (null | string | undefined)[]): SqlEnsureResult {
  const source: SqlSource = { driver: db.driver, origin: '', ownerUrl: db.ownerUrl, url: db.url };
  const result = runSqlRunner(source, driverPaths, {
    LT_SQL_ACTION: 'ensure',
    LT_SQL_DB: db.name,
    ...(db.configuredName ? { LT_SQL_FALLBACK_DB: db.configuredName } : {}),
  });
  if (!result.ok) return { created: false, failure: asFailure(result) };
  return {
    created: result.created === true,
    failure: null,
    ...(typeof result.warning === 'string' ? { warning: result.warning } : {}),
  };
}

/** List the databases on the project's SQL server, or null when that is impossible. */
export function listSqlDatabaseNames(source: SqlSource, driverPaths: (null | string | undefined)[]): null | string[] {
  const result = runSqlRunner(source, driverPaths, { LT_SQL_ACTION: 'list' });
  return result.ok && Array.isArray(result.names) ? (result.names as string[]) : null;
}

/**
 * The project's SQL source when `lt dev` may list and remove databases on it: configured, and every
 * URL pointing at this machine. Null otherwise — a shared or remote server is never touched.
 */
export function localSqlSource(apiDir: null | string, baseEnv: NodeJS.ProcessEnv = {}): null | SqlSource {
  const { sql } = detectDatabaseSetup(apiDir, baseEnv);
  if (!sql) return null;
  return [sql.url, sql.ownerUrl].every((url) => !url || sqlHostIsLocal(url)) ? sql : null;
}

/**
 * Decide the databases one stack uses. Pure: nothing is created here.
 *
 * @param keepConfiguredSqlDb true for the base dev stack — it keeps the database the project
 *   configures (so a developer's data stays where it is); tickets and test stacks get `dbName`.
 */
export function planStackDatabases(args: {
  apiDir: null | string;
  baseEnv?: NodeJS.ProcessEnv;
  dbName: string;
  keepConfiguredSqlDb: boolean;
  /** The main checkout's API dir when `apiDir` lies in a linked worktree (see detectDatabaseSetup). */
  mainApiDir?: null | string;
}): StackDatabases {
  const { apiDir, baseEnv = {}, dbName, keepConfiguredSqlDb, mainApiDir = null } = args;
  const setup = detectDatabaseSetup(apiDir, baseEnv, mainApiDir);
  const mongoDisplay = setup.mongo ? [`mongodb://127.0.0.1/${dbName}`] : [];
  const unisolated = (problem: string): StackDatabases => ({
    displayUrls: mongoDisplay,
    mongo: setup.mongo,
    sql: null,
    sqlProblem: problem,
  });

  if (setup.sqlProblem) return unisolated(setup.sqlProblem);
  if (!setup.sql) return { displayUrls: mongoDisplay, mongo: setup.mongo, sql: null, sqlProblem: null };

  const source = setup.sql;
  for (const url of [source.url, source.ownerUrl].filter((u): u is string => Boolean(u))) {
    if (!sqlHostIsLocal(url)) {
      return unisolated(
        `the SQL URL from ${source.origin} reaches a server other than this machine (${displaySqlUrl(url).replace(/\/[^/]*$/, '')}, its query or PGHOST) — lt dev creates databases only on a local server`,
      );
    }
  }

  const configuredName = sqlDatabaseNameOf(source.url);
  const name = keepConfiguredSqlDb && configuredName ? configuredName : dbName;
  const nameProblem = sqlDatabaseNameProblem(name);
  if (nameProblem) return unisolated(nameProblem);
  // The base dev stack keeps the configured database, while tickets and test stacks derive theirs
  // from `dbName` — two schemes that can meet: configured `shop-admin`, ticket `admin`. A stack must
  // never take over the developer's database (and `lt ticket stop` would then remove it).
  if (!keepConfiguredSqlDb && name === configuredName) {
    return unisolated(
      `this stack's database "${name}" is the one the project's configuration names for its dev stack — choose a different ticket id`,
    );
  }

  const url = withSqlDatabaseName(source.url, name);
  const sql: StackSqlDatabase = {
    configuredName,
    display: displaySqlUrl(url),
    driver: source.driver,
    name,
    url,
  };
  if (source.ownerUrl) sql.ownerUrl = withSqlDatabaseName(source.ownerUrl, name);
  return { displayUrls: [sql.display, ...mongoDisplay], mongo: setup.mongo, sql, sqlProblem: null };
}

/** The database a URL names, or null when it names none or builds it from a variable. */
export function sqlDatabaseNameOf(url: string): null | string {
  const parts = splitSqlUrl(url);
  if (!parts || parts.path.includes(PLACEHOLDER)) return null;
  const name = parts.path.replace(/^\//, '');
  try {
    return decodeURIComponent(name) || null;
  } catch {
    return null;
  }
}

/**
 * Why a database name cannot be used for a stack, or null.
 *
 * The name is quoted in `CREATE` / `DROP DATABASE` and placed in a URL path, so it is restricted to
 * what every derivation in `lt dev` produces; and it must fit PostgreSQL's 63-byte limit, which
 * TRUNCATES longer names without a word, so two long ticket names could map onto one database.
 */
export function sqlDatabaseNameProblem(name: string): null | string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(name)) {
    return `the database name "${name}" contains characters lt dev does not use in SQL database names (allowed: letters, digits, "_", "-")`;
  }
  if (name.length > SQL_DB_NAME_MAX) {
    return `the database name "${name}" is longer than ${SQL_DB_NAME_MAX} characters, which PostgreSQL would silently truncate — shorten the project's dbName or the ticket id`;
  }
  return null;
}

/** Human name of a driver (`PostgreSQL`). */
export function sqlDriverLabel(driver: SqlDriver): string {
  return SQL_DRIVER_LABEL[driver];
}

/** The SQL flavour a URL's scheme names, or null for anything else (MongoDB included). */
export function sqlDriverOf(url: string): null | SqlDriver {
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url.trim())?.[0]?.toLowerCase();
  return scheme ? (SQL_SCHEMES[scheme] ?? null) : null;
}

/**
 * True when every host the driver will connect to is this machine (or a local socket). `lt dev`
 * creates and drops databases only there — never on a shared or remote server.
 *
 * Judged on what the driver uses, not on the authority alone: `pg` lets the query override the
 * host (`?host=db.example.com` wins over `127.0.0.1`), and an empty host falls back to `PGHOST`,
 * which the runner inherits from this process (`env`). The MySQL runner ignores the query and
 * reads no environment, so only the authority counts there.
 */
export function sqlHostIsLocal(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const parts = splitSqlUrl(url);
  if (!parts) return false;
  const hostPort = parts.authority.slice(parts.authority.lastIndexOf('@') + 1);
  const host = hostPort.startsWith('[') ? hostPort.slice(1, hostPort.indexOf(']')) : hostPort.split(':')[0];
  const hosts = [host];
  if (sqlDriverOf(url) === 'postgres') {
    const query = new URLSearchParams(parts.query.startsWith('?') ? parts.query.slice(1).split('#')[0] : '');
    const fromQuery = [...query.getAll('host'), ...query.getAll('hostaddr')];
    hosts.push(...fromQuery);
    if (!host.trim() && fromQuery.length === 0) hosts.push(env.PGHOST ?? '', env.PGHOSTADDR ?? '');
  }
  return hosts
    .flatMap((h) => h.split(','))
    .map((h) => h.trim().toLowerCase())
    .every(
      (h) =>
        // empty: a local socket (or pg's `localhost` default); `/…`: a socket directory
        h === '' || h.startsWith('/') || h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h),
    );
}

/**
 * Split guarded removal candidates into what may go and what must stay on the SQL server: the
 * database the project configures for its dev stack is never removed, whatever its name looks
 * like. The ticket and prune guards judge names by their shape; this one knows which database
 * holds the developer's data.
 */
export function sqlRemovalTargets(source: SqlSource, names: string[]): { refused: string[]; targets: string[] } {
  const configured = sqlDatabaseNameOf(source.url);
  return {
    refused: names.filter((name) => name === configured),
    targets: names.filter((name) => name !== configured),
  };
}

/** The URL with its database (path) replaced — scheme, credentials, host, port and query stay. */
export function withSqlDatabaseName(url: string, dbName: string): string {
  const parts = splitSqlUrl(url);
  if (!parts) return url;
  return `${parts.scheme}${parts.authority}/${encodeURIComponent(dbName)}${parts.query}`;
}

function asFailure(result: Record<string, unknown>): SqlFailure {
  const reason = result.reason as SqlFailureReason;
  return {
    message: typeof result.message === 'string' ? result.message : 'no answer from the database runner',
    reason: ['auth', 'denied', 'failed', 'no-driver', 'unreachable'].includes(reason) ? reason : 'failed',
  };
}

/** Problem text for a URL that cannot be given a per-stack database name. */
function derivationProblem(text: string, origin: string): null | string {
  const parts = splitSqlUrl(text);
  if (!parts) return `the SQL URL from ${origin} cannot be parsed`;
  if (parts.authority.includes(PLACEHOLDER) || parts.query.includes(PLACEHOLDER)) {
    return `the SQL URL in ${origin} builds its host or credentials from variables — set NSC__DATABASE__URL (and NSC__DATABASE__OWNER_URL) for the local server in the API's .env`;
  }
  return null;
}

/**
 * Pick one URL for `key`: shell → `.env` → config literal (the precedence nest-server applies).
 * Several DIFFERENT literals in config.env.ts are resolved in favour of those under a `local`
 * key; when that still leaves more than one, the URL is reported as ambiguous rather than guessed.
 */
function pickSqlUrl(
  key: 'NSC__DATABASE__OWNER_URL' | 'NSC__DATABASE__URL',
  baseEnv: NodeJS.ProcessEnv,
  dotEnv: Record<string, string>,
  dotEnvLabel: string,
  literals: ConfigUrl[],
): { origin: string; problem?: string; value?: string } {
  const fromEnv = (value: string | undefined, origin: string) => {
    if (!value) return null;
    if (!sqlDriverOf(value)) return { origin }; // a MongoDB or other URL here is not ours to interpret
    const problem = derivationProblem(value, origin);
    return problem ? { origin, problem } : { origin, value };
  };
  const shell = fromEnv(baseEnv[key], `${key} (shell)`);
  if (shell) return shell;
  const file = fromEnv(dotEnv[key], `${key} in ${dotEnvLabel}`);
  if (file) return file;

  const field = key === 'NSC__DATABASE__URL' ? 'database.url' : 'database.ownerUrl';
  const origin = `${field} in src/config.env.ts`;
  const sql = literals.filter((l) => sqlDriverOf(l.text));
  if (sql.length === 0) return { origin };
  const preferred = sql.some((l) => l.local) ? sql.filter((l) => l.local) : sql;
  const distinct = [...new Map(preferred.map((l) => [withSqlDatabaseName(l.text, '-'), l])).values()];
  if (distinct.length > 1) {
    return {
      origin,
      problem: `src/config.env.ts names ${distinct.length} different SQL servers for ${field} — set NSC__DATABASE__URL (and NSC__DATABASE__OWNER_URL) for the local server in the API's .env`,
    };
  }
  const problem = derivationProblem(distinct[0].text, origin);
  return problem ? { origin, problem } : { origin, value: distinct[0].text };
}

/**
 * What src/config.env.ts says about databases, read from the AST: comments are not part of it, so
 * the starter's commented-out `database` example never counts.
 */
function readConfigDatabase(file: string): { mongoose: boolean; ownerUrls: ConfigUrl[]; urls: ConfigUrl[] } {
  const result = { mongoose: false, ownerUrls: [] as ConfigUrl[], urls: [] as ConfigUrl[] };
  if (!existsSync(file)) return result;
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return result;
  }

  // Lazy: gluegun loads every command module on every `lt` run, and TypeScript is large.
  const ts = require('typescript') as typeof import('typescript');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

  const textOf = (node: import('typescript').Node): null | string => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      return node.head.text + node.templateSpans.map((span) => PLACEHOLDER + span.literal.text).join('');
    }
    // `process.env.X || 'postgres://…'`: the literal is what applies when the variable is unset
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      return textOf(node.right);
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      return textOf(node.expression);
    }
    return null;
  };
  const nameOf = (name: import('typescript').PropertyName): null | string =>
    ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;

  const visit = (node: import('typescript').Node, local: boolean): void => {
    let childLocal = local;
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'mongoose') result.mongoose = true;
    if (ts.isPropertyAssignment(node)) {
      const name = nameOf(node.name);
      if (name === 'mongoose') result.mongoose = true;
      if (name === 'local') childLocal = true;
      if (name === 'database') {
        const init = node.initializer;
        const direct = textOf(init);
        if (direct !== null) result.urls.push({ local, text: direct });
        if (ts.isObjectLiteralExpression(init)) {
          for (const prop of init.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const key = nameOf(prop.name);
            const text = textOf(prop.initializer);
            if (text === null) continue;
            if (key === 'url') result.urls.push({ local, text });
            if (key === 'ownerUrl') result.ownerUrls.push({ local, text });
          }
        }
      }
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /^mongodb(\+srv)?:\/\//i.test(node.text)
    ) {
      result.mongoose = true;
    }
    ts.forEachChild(node, (child) => visit(child, childLocal));
  };
  visit(sf, false);
  return result;
}

/** `KEY=value` pairs of a `.env` file (no interpolation, no multi-line values), or `{}`. */
function readDotEnv(file: string): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim();
    const raw = trimmed.slice(eq + 1).trim();
    const quoted =
      raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")));
    values[key] = quoted ? raw.slice(1, -1) : raw;
  }
  return values;
}

/**
 * Run the bundled runner (`templates/dev-sql/runner.cjs`) with the project's own driver.
 * Every value travels through the environment; the runner prints one JSON line.
 */
function runSqlRunner(
  source: SqlSource,
  driverPaths: (null | string | undefined)[],
  vars: Record<string, string>,
): Record<string, unknown> {
  const request = source.driver === 'postgres' ? 'pg' : 'mysql2/promise';
  let driverPath: null | string = null;
  for (const dir of driverPaths.filter((d): d is string => Boolean(d))) {
    try {
      driverPath = require.resolve(request, { paths: [dir] });
      break;
    } catch {
      /* try the next path */
    }
  }
  if (!driverPath) return { message: `${request} not found`, ok: false, reason: 'no-driver' };

  try {
    const stdout = execFileSync(process.execPath, [join(__dirname, '..', 'templates', 'dev-sql', 'runner.cjs')], {
      env: {
        ...process.env,
        ...vars,
        LT_SQL_ADMIN_URL: source.ownerUrl ?? source.url,
        LT_SQL_APP_URL: source.url,
        LT_SQL_DRIVER_PATH: driverPath,
        LT_SQL_KIND: source.driver === 'postgres' ? 'postgres' : 'mysql',
      },
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: RUNNER_TIMEOUT_MS,
    }).toString();
    const last = stdout.trim().split('\n').pop() ?? '';
    return JSON.parse(last) as Record<string, unknown>;
  } catch (e) {
    const timedOut =
      (e as NodeJS.ErrnoException).code === 'ETIMEDOUT' || (e as { signal?: string }).signal === 'SIGKILL';
    return {
      message: timedOut ? `no answer within ${RUNNER_TIMEOUT_MS / 1000} s` : (e as Error).message.split('\n')[0],
      ok: false,
      reason: timedOut ? 'unreachable' : 'failed',
    };
  }
}

/** `scheme://`, authority (userinfo@host:port), path, `?query#fragment`. */
function splitSqlUrl(url: string): null | { authority: string; path: string; query: string; scheme: string } {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url)?.[0];
  if (!scheme) return null;
  const rest = url.slice(scheme.length);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const tail = authorityEnd === -1 ? '' : rest.slice(authorityEnd);
  const queryStart = tail.search(/[?#]/);
  return {
    authority,
    path: queryStart === -1 ? tail : tail.slice(0, queryStart),
    query: queryStart === -1 ? '' : tail.slice(queryStart),
    scheme,
  };
}
