import { execFileSync } from 'child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildDevEnv } from '../src/lib/dev-env';
import { DevIdentity } from '../src/lib/dev-identity';
import { patchClaudeMd } from '../src/lib/dev-patches';
import {
  describeSqlFailure,
  detectDatabaseSetup,
  displaySqlUrl,
  dropSqlDatabases,
  ensureSqlDatabase,
  listSqlDatabaseNames,
  localSqlSource,
  planStackDatabases,
  sqlDatabaseNameOf,
  sqlDatabaseNameProblem,
  sqlDriverOf,
  sqlHostIsLocal,
  sqlRemovalTargets,
  SqlSource,
  StackSqlDatabase,
  withSqlDatabaseName,
} from '../src/lib/dev-sql';
import { registryDbUrls } from '../src/lib/dev-state';
import { mainCheckoutApiDir } from '../src/lib/dev-ticket';

const identity: DevIdentity = {
  root: '/tmp/fake',
  slug: 'shop',
  subdomains: {
    api: { hostname: 'api.shop.localhost', isPrimaryApp: false, subdir: 'projects/api' },
    app: { hostname: 'shop.localhost', isPrimaryApp: true, subdir: 'projects/app' },
  },
};

/** The starter's MongoDB setup, with its `database` example commented out as nest-server-starter ships it. */
const MONGO_CONFIG = `
const base = {
  // database: {
  //   ownerUrl: 'postgres://owner_role@db/project',
  //   url: 'postgres://app_role@db/project',
  // },
  healthCheck: { configs: { database: { enabled: true } }, enabled: true },
  mongoose: { uri: process.env.NSC__MONGOOSE__URI || \`mongodb://127.0.0.1/\${options.dbName}\` },
};
export const config = { local: localConfig('local', { dbName: 'shop-local' }) };
`;

const SQL_ONLY_CONFIG = `
const base = {
  database: {
    ownerUrl: 'postgres://shop_owner:owner%40secret@127.0.0.1:5432/shop',
    url: 'postgres://shop_app:app-secret@127.0.0.1:5432/shop?sslmode=disable',
  },
};
export const config = { local: localConfig('local', { dbName: 'shop-local' }) };
`;

let dir: string;

function apiProject(files: Record<string, string>): string {
  const api = join(dir, `api-${Math.random().toString(36).slice(2)}`);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(api, rel, '..'), { recursive: true });
    writeFileSync(join(api, rel), content);
  }
  return api;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lt-dev-sql-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('dev-sql / URL helpers', () => {
  test('withSqlDatabaseName replaces only the database', () => {
    expect(withSqlDatabaseName('postgres://app:p%40ss@127.0.0.1:5432/shop?sslmode=disable', 'shop-2314')).toBe(
      'postgres://app:p%40ss@127.0.0.1:5432/shop-2314?sslmode=disable',
    );
    expect(withSqlDatabaseName('mysql://app@localhost:3306', 'shop-test')).toBe('mysql://app@localhost:3306/shop-test');
  });

  test('displaySqlUrl never shows credentials or query options', () => {
    expect(displaySqlUrl('postgres://app:secret@127.0.0.1:5432/shop?password=x')).toBe(
      'postgres://127.0.0.1:5432/shop',
    );
  });

  test('sqlDriverOf reads the scheme; MongoDB is not SQL', () => {
    expect(sqlDriverOf('postgresql://h/db')).toBe('postgres');
    expect(sqlDriverOf('MARIADB://h/db')).toBe('mariadb');
    expect(sqlDriverOf('mysql://h/db')).toBe('mysql');
    expect(sqlDriverOf('mongodb://127.0.0.1/db')).toBeNull();
  });

  test('sqlHostIsLocal accepts loopback and sockets only', () => {
    for (const url of [
      'postgres://u@localhost/d',
      'postgres://u@127.0.0.1:5432/d',
      'mysql://u@[::1]:3306/d',
      'postgres:///d',
      'postgres://u@localhost/d?host=/var/run/postgresql',
      // the MySQL runner ignores the query
      'mysql://u@127.0.0.1/d?host=sql.example.com',
    ]) {
      expect(sqlHostIsLocal(url, {})).toBe(true);
    }
    for (const url of [
      'postgres://u@db/d',
      'postgres://u@10.0.0.5/d',
      'mysql://u@sql.example.com/d',
      'postgres://u@127.0.0.1.nip.io/d',
      // pg lets the query override the authority's host
      'postgres://u@127.0.0.1:5432/d?host=db.example.com',
      'postgres://u@localhost/d?sslmode=disable&hostaddr=10.0.0.5',
      'postgres://u@localhost/d?host=/tmp,db.example.com',
    ]) {
      expect(sqlHostIsLocal(url, {})).toBe(false);
    }
  });

  test('sqlHostIsLocal follows an empty host to PGHOST, as pg does', () => {
    expect(sqlHostIsLocal('postgres:///d', { PGHOST: 'db.internal' })).toBe(false);
    expect(sqlHostIsLocal('postgres:///d', { PGHOSTADDR: '10.0.0.5' })).toBe(false);
    expect(sqlHostIsLocal('postgres:///d', { PGHOST: '/tmp' })).toBe(true);
    expect(sqlHostIsLocal('postgres:///d', { PGHOST: '127.0.0.1' })).toBe(true);
    // an explicit host in the URL wins over PGHOST, so PGHOST no longer matters
    expect(sqlHostIsLocal('postgres://u@127.0.0.1/d', { PGHOST: 'db.internal' })).toBe(true);
    // MySQL reads no PGHOST
    expect(sqlHostIsLocal('mysql:///d', { PGHOST: 'db.internal' })).toBe(true);
  });

  test('sqlDatabaseNameProblem refuses names that would need escaping or get truncated', () => {
    expect(sqlDatabaseNameProblem('shop-2314-test-3')).toBeNull();
    expect(sqlDatabaseNameProblem('shop"; DROP DATABASE x; --')).toMatch(/characters/);
    expect(sqlDatabaseNameProblem('shop.local')).toMatch(/characters/);
    expect(sqlDatabaseNameProblem('a'.repeat(64))).toMatch(/truncate/);
  });

  test('sqlDatabaseNameOf reads the path', () => {
    expect(sqlDatabaseNameOf('postgres://u@h:1/shop?x=1')).toBe('shop');
    expect(sqlDatabaseNameOf('postgres://u@h:1')).toBeNull();
  });
});

describe('dev-sql / detectDatabaseSetup', () => {
  test('a MongoDB project stays on MongoDB — the commented-out example does not count', () => {
    const api = apiProject({ 'src/config.env.ts': MONGO_CONFIG });
    expect(detectDatabaseSetup(api, {})).toEqual({ mongo: true, sql: null, sqlProblem: null });
  });

  test('a `pg` dependency alone is not SQL (TurboOps uses pg for an unrelated database)', () => {
    const api = apiProject({
      'package.json': JSON.stringify({ dependencies: { mysql2: '3.0.0', pg: '8.23.1' } }),
      'src/config.env.ts': MONGO_CONFIG,
    });
    expect(detectDatabaseSetup(api, {}).sql).toBeNull();
  });

  test('SQL alone: both URLs from the config, and no MongoDB', () => {
    const api = apiProject({ 'src/config.env.ts': SQL_ONLY_CONFIG });
    const setup = detectDatabaseSetup(api, {});
    expect(setup.mongo).toBe(false);
    expect(setup.sql).toEqual({
      driver: 'postgres',
      origin: 'database.url in src/config.env.ts',
      ownerUrl: 'postgres://shop_owner:owner%40secret@127.0.0.1:5432/shop',
      url: 'postgres://shop_app:app-secret@127.0.0.1:5432/shop?sslmode=disable',
    });
  });

  test('SQL next to an explicit mongoose configuration keeps MongoDB (hybrid)', () => {
    const api = apiProject({
      'src/config.env.ts': `const base = { database: { url: 'mysql://app@127.0.0.1/shop' }, mongoose: { uri: 'x' } };`,
    });
    const setup = detectDatabaseSetup(api, {});
    expect(setup.mongo).toBe(true);
    expect(setup.sql?.driver).toBe('mysql');
  });

  test('NSC__MONGOOSE__URI in the .env keeps MongoDB for a project otherwise on SQL', () => {
    const api = apiProject({
      '.env': 'NSC__MONGOOSE__URI=mongodb://127.0.0.1/x\n',
      'src/config.env.ts': SQL_ONLY_CONFIG,
    });
    expect(detectDatabaseSetup(api, {}).mongo).toBe(true);
  });

  test('precedence per URL: shell, then .env, then the config literal', () => {
    const api = apiProject({
      '.env': 'NSC__DATABASE__URL="postgres://env_app@localhost:5433/envdb"\n',
      'src/config.env.ts': SQL_ONLY_CONFIG,
    });
    const fromFile = detectDatabaseSetup(api, {}).sql;
    expect(fromFile?.url).toBe('postgres://env_app@localhost:5433/envdb');
    expect(fromFile?.origin).toBe("NSC__DATABASE__URL in the API's .env");
    // the owner URL is resolved on its own, as nest-server merges it
    expect(fromFile?.ownerUrl).toBe('postgres://shop_owner:owner%40secret@127.0.0.1:5432/shop');

    const fromShell = detectDatabaseSetup(api, { NSC__DATABASE__URL: 'postgres://sh@127.0.0.1/shdb' }).sql;
    expect(fromShell?.url).toBe('postgres://sh@127.0.0.1/shdb');
  });

  test('a template literal with a variable database is fine, variable credentials are not', () => {
    const ok = apiProject({
      'src/config.env.ts': 'const b = { database: { url: `postgres://app@127.0.0.1:5432/${options.dbName}` } };',
    });
    expect(detectDatabaseSetup(ok, {}).sql?.url).toBe('postgres://app@127.0.0.1:5432/\u0000');

    const bad = apiProject({
      'src/config.env.ts': 'const b = { database: { url: `postgres://app:${process.env.PW}@127.0.0.1/shop` } };',
    });
    const setup = detectDatabaseSetup(bad, {});
    expect(setup.sql).toBeNull();
    expect(setup.sqlProblem).toMatch(/host or credentials from variables/);
  });

  test('`process.env.X || literal` uses the literal', () => {
    const api = apiProject({
      'src/config.env.ts': "const b = { database: process.env.NSC__DATABASE__URL || 'mariadb://app@127.0.0.1/shop' };",
    });
    expect(detectDatabaseSetup(api, {}).sql).toMatchObject({ driver: 'mariadb', url: 'mariadb://app@127.0.0.1/shop' });
  });

  test('different literals: the one under `local` wins, otherwise the URL is ambiguous', () => {
    const local = apiProject({
      'src/config.env.ts': `export const config = {
        local: { database: { url: 'postgres://app@127.0.0.1/shop' } },
        staging: { database: { url: 'postgres://app@staging-db/shop' } },
      };`,
    });
    expect(detectDatabaseSetup(local, {}).sql?.url).toBe('postgres://app@127.0.0.1/shop');

    const ambiguous = apiProject({
      'src/config.env.ts': `export const config = {
        a: { database: { url: 'postgres://app@127.0.0.1/shop' } },
        b: { database: { url: 'postgres://app@other-db/shop' } },
      };`,
    });
    expect(detectDatabaseSetup(ambiguous, {}).sqlProblem).toMatch(/2 different SQL servers/);
  });

  test('an owner URL without an application URL is reported', () => {
    const api = apiProject({ '.env': 'NSC__DATABASE__OWNER_URL=postgres://o@127.0.0.1/shop\n' });
    expect(detectDatabaseSetup(api, {}).sqlProblem).toMatch(/without an application URL/);
  });

  test("a worktree without a .env reads the main checkout's, its own .env still wins", () => {
    const main = apiProject({
      '.env': 'NSC__DATABASE__URL=postgres://app@127.0.0.1/shop\n',
      'src/config.env.ts': 'export default { local: {} };',
    });
    // git checks out no ignored file, so a ticket worktree has config.env.ts but no .env
    const worktree = apiProject({ 'src/config.env.ts': 'export default { local: {} };' });

    expect(detectDatabaseSetup(worktree, {}).sql).toBeNull();
    const viaMain = detectDatabaseSetup(worktree, {}, main);
    expect(viaMain.sql?.url).toBe('postgres://app@127.0.0.1/shop');
    expect(viaMain.sql?.origin).toBe("NSC__DATABASE__URL in the main checkout's API .env");
    expect(viaMain.mongo).toBe(false);
    expect(
      planStackDatabases({ apiDir: worktree, dbName: 'shop-2314', keepConfiguredSqlDb: false, mainApiDir: main }).sql
        ?.name,
    ).toBe('shop-2314');

    writeFileSync(join(worktree, '.env'), 'NSC__DATABASE__URL=postgres://own@127.0.0.1/own\n');
    expect(detectDatabaseSetup(worktree, {}, main).sql?.url).toBe('postgres://own@127.0.0.1/own');
  });

  test('mainCheckoutApiDir maps a linked worktree onto the main checkout, and nothing else', () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, stdio: 'ignore' });
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'projects', 'api'), { recursive: true });
    writeFileSync(join(repo, 'projects', 'api', 'package.json'), '{}\n');
    git(repo, 'init', '-q', '-b', 'dev');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    const worktree = join(dir, 'repo-2314');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/DEV-2314', worktree);

    expect(realpathSync(mainCheckoutApiDir({ apiDir: join(worktree, 'projects', 'api'), root: worktree }) ?? '')).toBe(
      realpathSync(join(repo, 'projects', 'api')),
    );
    expect(mainCheckoutApiDir({ apiDir: join(repo, 'projects', 'api'), root: repo })).toBeNull();
    expect(mainCheckoutApiDir({ apiDir: null, root: worktree })).toBeNull();
    const plain = join(dir, 'no-git');
    mkdirSync(plain);
    expect(mainCheckoutApiDir({ apiDir: plain, root: plain })).toBeNull();
  });
});

describe('dev-sql / planStackDatabases', () => {
  test('the base dev stack keeps the configured database; a ticket stack gets its own', () => {
    const api = apiProject({ 'src/config.env.ts': SQL_ONLY_CONFIG });
    const base = planStackDatabases({ apiDir: api, dbName: 'shop-local', keepConfiguredSqlDb: true });
    expect(base.sql?.name).toBe('shop');
    expect(base.mongo).toBe(false);
    expect(base.displayUrls).toEqual(['postgres://127.0.0.1:5432/shop']);

    const ticket = planStackDatabases({ apiDir: api, dbName: 'shop-2314', keepConfiguredSqlDb: false });
    expect(ticket.sql).toMatchObject({
      configuredName: 'shop',
      name: 'shop-2314',
      ownerUrl: 'postgres://shop_owner:owner%40secret@127.0.0.1:5432/shop-2314',
      url: 'postgres://shop_app:app-secret@127.0.0.1:5432/shop-2314?sslmode=disable',
    });
  });

  test('a variable database name falls back to the stack name, also for the base stack', () => {
    const api = apiProject({
      'src/config.env.ts':
        'const b = { database: { url: `postgres://app@127.0.0.1/${options.dbName}` }, mongoose: {} };',
    });
    const base = planStackDatabases({ apiDir: api, dbName: 'shop-local', keepConfiguredSqlDb: true });
    expect(base.sql?.url).toBe('postgres://app@127.0.0.1/shop-local');
    expect(base.displayUrls).toEqual(['postgres://127.0.0.1/shop-local', 'mongodb://127.0.0.1/shop-local']);
  });

  test('a remote server is never provisioned — the stack stays on the configuration', () => {
    const api = apiProject({ '.env': 'NSC__DATABASE__URL=postgres://app@db.internal/shop\n' });
    const plan = planStackDatabases({ apiDir: api, dbName: 'shop-test', keepConfiguredSqlDb: false });
    expect(plan.sql).toBeNull();
    expect(plan.sqlProblem).toMatch(/other than this machine/);
  });

  test('a remote OWNER URL is refused too: it is the one every create, list and drop logs in with', () => {
    const api = apiProject({
      '.env': 'NSC__DATABASE__URL=postgres://app@127.0.0.1/shop\n',
      'src/config.env.ts':
        "export default { local: { database: { ownerUrl: 'postgres://owner@staging-db.example.com/shop' } } };",
    });
    expect(detectDatabaseSetup(api, {}).sql?.ownerUrl).toBe('postgres://owner@staging-db.example.com/shop');
    expect(localSqlSource(api, {})).toBeNull();
    const plan = planStackDatabases({ apiDir: api, dbName: 'shop-9', keepConfiguredSqlDb: false });
    expect(plan.sql).toBeNull();
    expect(plan.sqlProblem).toMatch(/other than this machine/);
  });

  test('a loopback authority whose query sends pg elsewhere is no local server either', () => {
    const api = apiProject({ '.env': 'NSC__DATABASE__URL=postgres://app@127.0.0.1:5432/shop?host=db.internal\n' });
    expect(planStackDatabases({ apiDir: api, dbName: 'shop-9', keepConfiguredSqlDb: false }).sql).toBeNull();
    expect(localSqlSource(api, {})).toBeNull();
  });

  test('a stack never takes over the configured database (configured `shop-admin`, ticket `admin`)', () => {
    const api = apiProject({ '.env': 'NSC__DATABASE__URL=postgres://app@127.0.0.1/shop-admin\n' });
    const plan = planStackDatabases({ apiDir: api, dbName: 'shop-admin', keepConfiguredSqlDb: false });
    expect(plan.sql).toBeNull();
    expect(plan.sqlProblem).toMatch(/configuration names for its dev stack/);
  });

  test('a name PostgreSQL would truncate is refused', () => {
    const api = apiProject({ 'src/config.env.ts': SQL_ONLY_CONFIG });
    const plan = planStackDatabases({ apiDir: api, dbName: `shop-${'x'.repeat(60)}`, keepConfiguredSqlDb: false });
    expect(plan.sqlProblem).toMatch(/truncate/);
  });

  test('a MongoDB project is unchanged', () => {
    const api = apiProject({ 'src/config.env.ts': MONGO_CONFIG });
    expect(planStackDatabases({ apiDir: api, dbName: 'shop-local', keepConfiguredSqlDb: true })).toEqual({
      displayUrls: ['mongodb://127.0.0.1/shop-local'],
      mongo: true,
      sql: null,
      sqlProblem: null,
    });
  });

  test('localSqlSource only returns a local server; sqlRemovalTargets keeps the configured database', () => {
    const remote = apiProject({ '.env': 'NSC__DATABASE__URL=postgres://app@db.internal/shop\n' });
    expect(localSqlSource(remote, {})).toBeNull();

    const api = apiProject({ 'src/config.env.ts': SQL_ONLY_CONFIG });
    const source = localSqlSource(api, {}) as SqlSource;
    expect(sqlRemovalTargets(source, ['shop-2314', 'shop', 'shop-2314-test'])).toEqual({
      refused: ['shop'],
      targets: ['shop-2314', 'shop-2314-test'],
    });
  });
});

describe('dev-sql / buildDevEnv and the CLAUDE.md block', () => {
  test('the SQL URLs go to the API only, and a project on SQL alone gets no NSC__MONGOOSE__URI', () => {
    const api = apiProject({ 'src/config.env.ts': SQL_ONLY_CONFIG });
    const databases = planStackDatabases({ apiDir: api, dbName: 'shop-2314', keepConfiguredSqlDb: false });
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, databases, dbName: 'shop-2314', identity });
    expect(env.api.env.NSC__DATABASE__URL).toBe(
      'postgres://shop_app:app-secret@127.0.0.1:5432/shop-2314?sslmode=disable',
    );
    expect(env.api.env.NSC__DATABASE__OWNER_URL).toBe('postgres://shop_owner:owner%40secret@127.0.0.1:5432/shop-2314');
    expect(env.app.env.NSC__DATABASE__URL).toBeUndefined();
    expect(env.app.env.NSC__DATABASE__OWNER_URL).toBeUndefined();
    expect(env.api.env.NSC__MONGOOSE__URI).toBeUndefined();
    expect(env.app.env.NSC__MONGOOSE__URI).toBeUndefined();
    // nest-base's DATABASE_URL would name `shop-2314` on port 5432, a database this project does not have
    expect(env.api.env.DATABASE_URL).toBeUndefined();
    expect(env.app.env.DATABASE_URL).toBeUndefined();
  });

  test('a SQL project whose URL cannot be isolated gets no DATABASE_URL either', () => {
    const databases = { mongo: true, sql: null, sqlProblem: 'the SQL URL points at db.internal' };
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, databases, dbName: 'shop-2314', identity });
    expect(env.api.env.DATABASE_URL).toBeUndefined();
    expect(env.api.env.NSC__MONGOOSE__URI).toBe('mongodb://127.0.0.1/shop-2314');
  });

  test('without a database plan the env is what it always was', () => {
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, dbName: 'shop-local', identity });
    expect(env.api.env.NSC__MONGOOSE__URI).toBe('mongodb://127.0.0.1/shop-local');
    expect(env.api.env.DATABASE_URL).toBe('postgresql://shop-local:shop-local@localhost:5432/shop-local');
    expect(env.api.env.NSC__DATABASE__URL).toBeUndefined();
  });

  test('a MongoDB project keeps its CLAUDE.md block byte for byte', () => {
    const before = join(dir, 'a.md');
    const after = join(dir, 'b.md');
    writeFileSync(before, '# P\n');
    writeFileSync(after, '# P\n');
    patchClaudeMd(before, { dbName: 'shop-local', identity });
    patchClaudeMd(after, {
      databases: { mongo: true, sql: null, sqlProblem: null },
      dbName: 'shop-local',
      identity,
    });
    expect(readFileSync(after, 'utf8')).toBe(readFileSync(before, 'utf8'));
  });

  test('a SQL project names its database and the variables the API reads — not DATABASE_URL', () => {
    const api = apiProject({ 'src/config.env.ts': SQL_ONLY_CONFIG });
    const databases = planStackDatabases({ apiDir: api, dbName: 'shop-local', keepConfiguredSqlDb: true });
    const file = join(dir, 'CLAUDE.md');
    writeFileSync(file, '# P\n');
    patchClaudeMd(file, { databases, dbName: 'shop-local', identity });
    const block = readFileSync(file, 'utf8');
    expect(block).toContain('- SQL database: PostgreSQL `shop` on the local server');
    expect(block).toContain('`NSC__DATABASE__URL`, `NSC__DATABASE__OWNER_URL`');
    expect(block).not.toContain('mongodb://');
    expect(block).not.toContain('DATABASE_URL`,');
    expect(block).not.toMatch(/secret/);
  });

  test('registryDbUrls: recorded URLs for SQL, the MongoDB URL otherwise', () => {
    expect(registryDbUrls({ dbName: 'shop-local' })).toEqual(['mongodb://127.0.0.1/shop-local']);
    expect(registryDbUrls({ dbName: 'shop', dbUrls: ['postgres://127.0.0.1:5432/shop'] })).toEqual([
      'postgres://127.0.0.1:5432/shop',
    ]);
    expect(registryDbUrls({})).toEqual([]);
  });
});

/**
 * The bundled runner, run for real in a child process — against stand-ins for `pg` and `mysql2`
 * that record every statement with its parameters. What it proves: which SQL is sent, that names
 * and accounts travel quoted or as parameters, and how each failure is reported.
 */
describe('dev-sql / runner', () => {
  let project: string;
  let log: string;
  let state: string;

  const FAKE_PG = `
const fs = require('fs');
const st = () => JSON.parse(fs.readFileSync(process.env.FAKE_SQL_STATE, 'utf8'));
const save = (s) => fs.writeFileSync(process.env.FAKE_SQL_STATE, JSON.stringify(s));
const log = (e) => fs.appendFileSync(process.env.FAKE_SQL_LOG, JSON.stringify(e) + '\\n');
const fail = (f) => Object.assign(new Error(f.message), { code: f.code });
class Client {
  constructor(cfg) { this.url = new URL(cfg.connectionString); this.user = decodeURIComponent(this.url.username); }
  async connect() {
    const s = st(); const db = this.url.pathname.slice(1);
    if (s.connectError) throw fail(s.connectError);
    if ((s.missing || []).includes(db)) throw fail({ code: '3D000', message: 'database "' + db + '" does not exist' });
    log({ connect: db, user: this.user });
  }
  async query(sql, params) {
    log({ params, sql }); const s = st();
    if (sql.startsWith('SELECT 1 FROM pg_database')) return { rowCount: s.databases.includes(params[0]) ? 1 : 0, rows: [] };
    if (sql.startsWith('CREATE DATABASE')) { if (s.createError) throw fail(s.createError); s.databases.push(sql.match(/"(.*)"/)[1]); save(s); }
    if (sql.startsWith('SELECT datname')) return { rows: s.databases.map((datname) => ({ datname })) };
    if (sql.startsWith('DROP DATABASE')) { s.databases = s.databases.filter((d) => d !== sql.match(/"(.*)"/)[1]); save(s); }
    return { rowCount: 0, rows: [] };
  }
  async end() {}
}
module.exports = { Client };
`;

  const FAKE_MYSQL = `
const fs = require('fs');
const st = () => JSON.parse(fs.readFileSync(process.env.FAKE_SQL_STATE, 'utf8'));
const log = (e) => fs.appendFileSync(process.env.FAKE_SQL_LOG, JSON.stringify(e) + '\\n');
exports.createConnection = async (opts) => {
  log({ connect: opts.user, database: opts.database, host: opts.host, port: opts.port });
  return {
    async end() {},
    async query(sql, values) {
      log({ sql, values }); const s = st();
      if (sql.startsWith('SELECT CURRENT_USER()')) return [[{ account: opts.user + '@%' }]];
      if (sql.includes('WHERE SCHEMA_NAME = ?')) return [s.databases.includes(values[0]) ? [{ SCHEMA_NAME: values[0] }] : []];
      if (sql.startsWith('SELECT SCHEMA_NAME AS name')) return [s.databases.map((name) => ({ name }))];
      return [[]];
    },
  };
};
`;

  const pgDb = (name: string, configuredName: null | string = 'shop'): StackSqlDatabase => ({
    configuredName,
    display: `postgres://127.0.0.1:5432/${name}`,
    driver: 'postgres',
    name,
    ownerUrl: `postgres://shop_owner:o@127.0.0.1:5432/${name}`,
    url: `postgres://shop_app:a@127.0.0.1:5432/${name}`,
  });
  const entries = (): Array<Record<string, unknown>> =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const setState = (s: Record<string, unknown>) => writeFileSync(state, JSON.stringify({ databases: [], ...s }));

  beforeEach(() => {
    project = join(dir, 'project');
    mkdirSync(join(project, 'node_modules', 'pg'), { recursive: true });
    writeFileSync(join(project, 'node_modules', 'pg', 'package.json'), '{"name":"pg","main":"index.js"}');
    writeFileSync(join(project, 'node_modules', 'pg', 'index.js'), FAKE_PG);
    mkdirSync(join(project, 'node_modules', 'mysql2'), { recursive: true });
    writeFileSync(join(project, 'node_modules', 'mysql2', 'package.json'), '{"name":"mysql2","main":"promise.js"}');
    writeFileSync(join(project, 'node_modules', 'mysql2', 'promise.js'), FAKE_MYSQL);
    log = join(dir, 'sql.log');
    state = join(dir, 'state.json');
    appendFileSync(log, '');
    setState({});
    vi.stubEnv('FAKE_SQL_LOG', log);
    vi.stubEnv('FAKE_SQL_STATE', state);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('PostgreSQL: creates a missing database as the owner and grants CONNECT to the application role', () => {
    const result = ensureSqlDatabase(pgDb('shop-2314'), [project]);
    expect(result).toEqual({ created: true, failure: null });
    const sql = entries().filter((e) => e.sql);
    expect(entries()[0]).toEqual({ connect: 'postgres', user: 'shop_owner' });
    expect(sql.map((e) => e.sql)).toEqual([
      'SELECT 1 FROM pg_database WHERE datname = $1',
      'CREATE DATABASE "shop-2314"',
      'GRANT CONNECT ON DATABASE "shop-2314" TO "shop_app"',
    ]);
    expect(sql[0].params).toEqual(['shop-2314']);
  });

  test('PostgreSQL: an existing database is left alone', () => {
    setState({ databases: ['shop-2314'] });
    expect(ensureSqlDatabase(pgDb('shop-2314'), [project])).toEqual({ created: false, failure: null });
    expect(entries().some((e) => String(e.sql).startsWith('CREATE'))).toBe(false);
  });

  test('PostgreSQL: without a `postgres` database it falls back to template1', () => {
    setState({ missing: ['postgres'] });
    ensureSqlDatabase(pgDb('shop-test'), [project]);
    expect(entries()[0]).toEqual({ connect: 'template1', user: 'shop_owner' });
  });

  test('PostgreSQL: a missing CREATEDB is reported with the statement that fixes it', () => {
    setState({ createError: { code: '42501', message: 'permission denied to create database' } });
    const { failure } = ensureSqlDatabase(pgDb('shop-test'), [project]);
    expect(failure?.reason).toBe('denied');
    expect(describeSqlFailure(failure!, pgDb('shop-test'))).toMatch(/ALTER ROLE <owner> CREATEDB/);
  });

  test('PostgreSQL: a server that is not running reads as unreachable', () => {
    setState({ connectError: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' } });
    const { failure } = ensureSqlDatabase(pgDb('shop-test'), [project]);
    expect(failure?.reason).toBe('unreachable');
    expect(describeSqlFailure(failure!, pgDb('shop-test'))).toMatch(/start the local database server/);
  });

  test('MySQL: creates with nest-server collation and grants rows only, account and name as parameters', () => {
    const db: StackSqlDatabase = {
      configuredName: 'shop',
      display: 'mysql://127.0.0.1:3306/shop-test',
      driver: 'mysql',
      name: 'shop-test',
      ownerUrl: 'mysql://shop_owner:o@127.0.0.1:3306/shop-test',
      url: 'mysql://shop_app:a@127.0.0.1:3306/shop-test',
    };
    expect(ensureSqlDatabase(db, [project])).toEqual({ created: true, failure: null });
    const statements = entries().filter((e) => e.sql);
    expect(statements.map((e) => [e.sql, e.values])).toEqual([
      ['SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', ['shop-test']],
      ['CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', ['shop-test']],
      ['SELECT CURRENT_USER() AS account', undefined],
      ['GRANT SELECT, INSERT, UPDATE, DELETE ON ??.* TO ?@?', ['shop-test', 'shop_app', '%']],
    ]);
    // the admin connection names no database: it must work before the database exists
    const admin = entries().find((e) => e.connect === 'shop_owner');
    expect(admin).toMatchObject({ host: '127.0.0.1', port: 3306 });
    expect(admin).not.toHaveProperty('database');
  });

  test('list and remove go through the same runner; the configured database is refused before it runs', () => {
    setState({ databases: ['shop', 'shop-2314', 'shop-2314-test'] });
    const source: SqlSource = {
      driver: 'postgres',
      origin: 'test',
      ownerUrl: 'postgres://shop_owner:o@127.0.0.1:5432/shop',
      url: 'postgres://shop_app:a@127.0.0.1:5432/shop',
    };
    expect(listSqlDatabaseNames(source, [project])).toEqual(['shop', 'shop-2314', 'shop-2314-test']);

    expect(dropSqlDatabases(source, ['shop-2314', 'shop-2314-test'], [project])).toEqual({
      dropped: ['shop-2314', 'shop-2314-test'],
      failure: null,
    });
    expect(
      entries()
        .filter((e) => String(e.sql).startsWith('DROP'))
        .map((e) => e.sql),
    ).toEqual([
      'DROP DATABASE IF EXISTS "shop-2314" WITH (FORCE)',
      'DROP DATABASE IF EXISTS "shop-2314-test" WITH (FORCE)',
    ]);

    const before = entries().length;
    expect(dropSqlDatabases(source, ['shop'], [project]).failure?.message).toMatch(/configuration names/);
    expect(dropSqlDatabases(source, ['x"; DROP DATABASE shop; --'], [project]).failure?.reason).toBe('failed');
    expect(entries().length).toBe(before);
  });

  test('without the driver in the project the reason says so', () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    const { failure } = ensureSqlDatabase(pgDb('shop-test'), [empty]);
    expect(failure?.reason).toBe('no-driver');
    expect(describeSqlFailure(failure!, pgDb('shop-test'))).toMatch(/`pg`/);
  });
});
