import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
/** gluegun's OWN parser — the exact code path that produces `parameters.options`. */
const { parseParams } = require('gluegun/build/toolbox/parameter-tools');
import { tmpdir } from 'os';
import { join } from 'path';

import { buildIdentity, buildTicketIdentity } from '../src/lib/dev-identity';
import { patchApiConfig } from '../src/lib/dev-patches';
import { deriveTestDbName, deriveTicketDbName } from '../src/lib/dev-project';
import {
  checkGlobalSetupTicketSafe,
  clearTicketMarker,
  defaultTicketBranch,
  deriveTicketId,
  gitBranchExists,
  gitMainRepoRoot,
  gitRefExists,
  isReservedTicketId,
  isTicketScopedDb,
  keepDbFlag,
  listBaseRefChoices,
  listWorktrees,
  planTicketDbDrop,
  readTicketMarker,
  resolveBaseRef,
  resolveDevIdentity,
  worktreeAdd,
  worktreeDirtyOnlyAutoDiscardable,
  worktreeDirtyOnlyGenerated,
  worktreePathFor,
  worktreeRemove,
  worktreeSafetyReport,
  writeTicketMarker,
} from '../src/lib/dev-ticket';

/** Parse a real `lt ticket stop …` argv the way gluegun does. */
function stopArgv(...argv: string[]): Record<string, unknown> {
  return parseParams(['ticket', 'stop', ...argv]).options;
}

describe('dev-ticket', () => {
  describe('deriveTicketId', () => {
    test('ticket pattern → short numeric part', () => {
      expect(deriveTicketId('DEV-2200')).toBe('2200');
      expect(deriveTicketId('ABC-123')).toBe('123');
      expect(deriveTicketId('dev-2200')).toBe('2200');
    });
    test('free feature name → slug', () => {
      expect(deriveTicketId('checkout-refactor')).toBe('checkout-refactor');
      expect(deriveTicketId('Checkout Refactor')).toBe('checkout-refactor');
      expect(deriveTicketId('feature/Foo Bar')).toBe('feature-foo-bar');
    });
    test('--as override wins (slugified)', () => {
      expect(deriveTicketId('DEV-2200', 'cof')).toBe('cof');
      expect(deriveTicketId('DEV-2200', 'Check Out')).toBe('check-out');
    });
  });

  // `lt ticket stop` drops the ticket's databases BY DEFAULT (the env is gone
  // afterwards, so they would be orphans). Everything below guards that irreversible
  // step. These are not hypothetical: each `test` here fails against the naive
  // implementation and describes a way real data was destroyed.
  describe('keepDbFlag — the --keep-db opt-out must fail CLOSED', () => {
    test('no flag → drop (the default)', () => {
      expect(keepDbFlag({})).toEqual({ keep: false, strayValue: null });
      expect(keepDbFlag()).toEqual({ keep: false, strayValue: null });
    });

    test('--keep-db keeps (both key shapes yargs-parser emits, and each alone)', () => {
      expect(keepDbFlag({ 'keep-db': true, keepDb: true }).keep).toBe(true);
      expect(keepDbFlag({ keepDb: true }).keep).toBe(true);
      expect(keepDbFlag({ 'keep-db': true }).keep).toBe(true);
    });

    // REGRESSION: gluegun parses via yargs-parser and declares no booleans, so
    // `--keep-db=true` / `--keep-db true` arrive as the STRING 'true' and `--keep-db=1`
    // as the NUMBER 1. A strict `=== true` check reads all of them as "did not ask to
    // keep" and DROPS the databases the user explicitly asked to keep. Irreversibly.
    test.each([['true'], ['1'], [1], ['yes']])('--keep-db=%p (non-boolean from the parser) still keeps', (v) => {
      expect(keepDbFlag({ 'keep-db': v, keepDb: v }).keep).toBe(true);
    });

    test('only an EXPLICIT negation still drops', () => {
      expect(keepDbFlag({ 'keep-db': false, keepDb: false }).keep).toBe(false);
      expect(keepDbFlag({ 'keep-db': 'false', keepDb: 'false' }).keep).toBe(false);
      expect(keepDbFlag({ 'keep-db': 0, keepDb: 0 }).keep).toBe(false);
    });

    // `--keep-db` takes no value, so `lt ticket stop --keep-db 2200` makes yargs-parser
    // swallow the ticket id as the flag's value — leaving `parameters.first` undefined.
    // Hand it back so the command can recover it instead of silently stopping a
    // DIFFERENT ticket (whichever worktree the user happened to stand in).
    test('a swallowed positional is surfaced, and still keeps', () => {
      expect(keepDbFlag({ 'keep-db': 2200, keepDb: 2200 })).toEqual({
        keep: true,
        strayValue: '2200',
      });
      expect(keepDbFlag({ 'keep-db': 'login-fix' })).toEqual({
        keep: true,
        strayValue: 'login-fix',
      });
    });
  });

  // Locks the CONTRACT between gluegun's real parser and the guard. If a gluegun /
  // yargs-parser upgrade changes the option shapes, this fails LOUDLY — instead of
  // silently dropping a database.
  describe('keepDbFlag — against gluegun’s real argv parser', () => {
    test.each([
      [['2200'], false],
      [['2200', '--force'], false],
      [['2200', '--drop-db'], false], // the old opt-in flag → still drops (now a no-op)
      [['2200', '--no-keep-db'], false],
      [['2200', '--keep-db'], true],
      [['2200', '--keepDb'], true],
      [['2200', '--keep-db=true'], true],
      [['2200', '--keep-db', 'true'], true],
      [['2200', '--drop-db', '--keep-db'], true], // ambiguous → never destroy
    ])('lt ticket stop %j → keep=%s', (argv, keep) => {
      expect(keepDbFlag(stopArgv(...argv)).keep).toBe(keep);
    });

    test('`--keep-db <id>` swallows the id — it is recovered, not lost', () => {
      // The id never reaches the positionals, so `parameters.first` is undefined and the
      // command would otherwise fall back to the marker → stop a DIFFERENT ticket.
      expect(parseParams(['ticket', 'stop', '--keep-db', '2200']).array).not.toContain('2200');
      expect(keepDbFlag(stopArgv('--keep-db', '2200'))).toEqual({ keep: true, strayValue: '2200' });
    });
  });

  describe('isReservedTicketId', () => {
    // These ids derive a ticket DB that collides with the PROJECT's own dev/test DB
    // (both derivations strip a trailing `-(local|dev)` before adding their suffix).
    test.each([['local'], ['dev'], ['test'], ['e2e'], ['ci'], ['prod'], ['production'], ['staging']])(
      '"%s" is reserved',
      (id) => {
        expect(isReservedTicketId(id)).toBe(true);
      },
    );
    test('case-insensitive', () => {
      expect(isReservedTicketId('LOCAL')).toBe(true);
      expect(isReservedTicketId('Test')).toBe(true);
    });
    test('normal ticket ids are fine', () => {
      expect(isReservedTicketId('2200')).toBe(false);
      expect(isReservedTicketId('login-fix')).toBe(false);
      expect(isReservedTicketId('dev-2200')).toBe(false); // only the bare word collides
    });
  });

  describe('isTicketScopedDb — the drop can never reach a project database', () => {
    const projectDevDb = 'imo-local';
    const projectTestDb = deriveTestDbName(projectDevDb); // imo-test

    test('a ticket’s own databases are accepted', () => {
      expect(isTicketScopedDb('imo-2200', '2200', projectDevDb)).toBe(true);
      expect(isTicketScopedDb('imo-2200-test', '2200', projectDevDb)).toBe(true);
    });

    // The collision that made this guard necessary: ticket id `local` derives
    // `imo-local` (the developer's MAIN dev DB) and `imo-test` (the project's E2E DB).
    // Both look perfectly ticket-shaped — only an explicit project-DB exclusion catches them.
    test('the project’s OWN databases are refused, even when the derivation produced them', () => {
      expect(deriveTicketDbName(projectDevDb, 'local')).toBe(projectDevDb); // the trap
      expect(isTicketScopedDb(projectDevDb, 'local', projectDevDb)).toBe(false);
      expect(isTicketScopedDb(projectTestDb, 'local', projectDevDb)).toBe(false);
      expect(isTicketScopedDb(projectTestDb, 'test', projectDevDb)).toBe(false);
      expect(isTicketScopedDb(projectTestDb, 'dev', projectDevDb)).toBe(false);
    });

    test('another ticket’s database is refused', () => {
      expect(isTicketScopedDb('imo-2201', '2200', projectDevDb)).toBe(false);
    });

    test('an unrelated project’s database is refused', () => {
      expect(isTicketScopedDb('other-project-local', '2200', projectDevDb)).toBe(false);
    });
  });

  describe('planTicketDbDrop', () => {
    const projectDevDb = 'imo-local';
    const worktreePath = '/repos/imo-2200';

    test('derives the ticket’s dev + test DB when there is no registry entry', () => {
      expect(planTicketDbDrop({ hasApi: true, projectDevDb, ticketId: '2200', worktreePath })).toEqual({
        foreignEntryPath: null,
        refused: [],
        targets: ['imo-2200', 'imo-2200-test'],
      });
    });

    // An App-only project has no MongoDB at all (`normalizeRegistry` encodes this by
    // deleting `dbName`). Deriving one would invent a database that never existed and
    // warn twice about failing to drop it.
    test('App-only project → nothing to drop', () => {
      expect(planTicketDbDrop({ hasApi: false, projectDevDb, ticketId: '2200', worktreePath }).targets).toEqual([]);
    });

    test('trusts a registry entry that points at THIS worktree', () => {
      const plan = planTicketDbDrop({
        hasApi: true,
        projectDevDb,
        registryEntry: { dbName: 'imo-2200', path: worktreePath },
        ticketId: '2200',
        worktreePath,
      });
      expect(plan.targets).toEqual(['imo-2200', 'imo-2200-test']);
      expect(plan.foreignEntryPath).toBeNull();
    });

    // The registry is GLOBAL and keyed by slug alone, so `<slug>-<id>` can be a genuinely
    // different project: `imo` + ticket `admin` → key `imo-admin`, which a real sibling
    // project `imo-admin` may already own. Its dbName is ITS dev DB — dropping it would
    // destroy another project's data.
    test('ignores a registry entry owned by a DIFFERENT checkout', () => {
      const plan = planTicketDbDrop({
        hasApi: true,
        projectDevDb,
        registryEntry: { dbName: 'imo-admin-local', path: '/elsewhere/imo-admin' },
        ticketId: 'admin',
        worktreePath: '/repos/imo-admin',
      });
      expect(plan.foreignEntryPath).toBe('/elsewhere/imo-admin');
      expect(plan.targets).not.toContain('imo-admin-local'); // the other project's DB
      expect(plan.targets).toEqual(['imo-admin', 'imo-admin-test']); // ours, derived
    });

    test('refuses a reserved id that derives onto the project’s own databases', () => {
      const plan = planTicketDbDrop({
        hasApi: true,
        projectDevDb,
        ticketId: 'local',
        worktreePath,
      });
      expect(plan.targets).toEqual([]);
      expect(plan.refused).toEqual(['imo-local', 'imo-test']);
    });
  });

  describe('defaultTicketBranch', () => {
    test('preserves ticket id casing, sanitises free names', () => {
      expect(defaultTicketBranch('DEV-2200')).toBe('feat/DEV-2200');
      expect(defaultTicketBranch('checkout refactor')).toBe('feat/checkout-refactor');
    });
  });

  describe('buildTicketIdentity', () => {
    const base = buildIdentityFixture('svl');
    test('suffixes slug + every hostname with the id', () => {
      const t = buildTicketIdentity(base, '2200');
      expect(t.slug).toBe('svl-2200');
      expect(t.subdomains.app.hostname).toBe('svl-2200.localhost');
      expect(t.subdomains.api.hostname).toBe('api.svl-2200.localhost');
    });
  });

  describe('deriveTicketDbName', () => {
    test('strips -local/-dev and appends the id', () => {
      expect(deriveTicketDbName('svl-sports-system-local', '2200')).toBe('svl-sports-system-2200');
      expect(deriveTicketDbName('crm-dev', 'checkout')).toBe('crm-checkout');
    });
  });

  describe('worktreePathFor', () => {
    test('sibling of the main repo, named <slug>-<id>', () => {
      expect(worktreePathFor('/Users/x/code/svl-sports-system', 'svl', '2200')).toBe('/Users/x/code/svl-2200');
    });
  });

  describe('ticket marker', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lt-ticket-marker-'));
    });
    afterEach(() => rmSync(root, { force: true, recursive: true }));

    test('write → read round-trips the id; clear removes it', () => {
      expect(readTicketMarker(root)).toBeNull();
      writeTicketMarker(root, '2200');
      expect(readTicketMarker(root)).toBe('2200');
      clearTicketMarker(root);
      expect(readTicketMarker(root)).toBeNull();
    });
  });

  describe('resolveDevIdentity', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lt-ticket-resolve-'));
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'svl' }));
      mkdirSync(join(root, 'projects', 'api'), { recursive: true });
      mkdirSync(join(root, 'projects', 'app'), { recursive: true });
    });
    afterEach(() => rmSync(root, { force: true, recursive: true }));

    const layoutFor = (r: string) => ({
      apiDir: join(r, 'projects', 'api'),
      appDir: join(r, 'projects', 'app'),
      root: r,
      workspace: true,
    });

    test('no marker → plain project identity', () => {
      const res = resolveDevIdentity(layoutFor(root));
      expect(res.ticket).toBeNull();
      expect(res.identity.slug).toBe('svl');
      expect(res.dbName).toBe('svl-local');
    });

    test('marker → suffixed identity + per-ticket DB', () => {
      writeTicketMarker(root, '2200');
      const res = resolveDevIdentity(layoutFor(root));
      expect(res.ticket).toBe('2200');
      expect(res.identity.slug).toBe('svl-2200');
      expect(res.identity.subdomains.app.hostname).toBe('svl-2200.localhost');
      expect(res.dbName).toBe('svl-2200');
    });

    test('explicit --ticket option overrides the marker (raw name → id)', () => {
      writeTicketMarker(root, '2200');
      const res = resolveDevIdentity(layoutFor(root), { ticket: 'DEV-2201' });
      expect(res.ticket).toBe('2201');
      expect(res.identity.slug).toBe('svl-2201');
    });

    test('marker file is written under .lt-dev/', () => {
      writeTicketMarker(root, 'x');
      expect(existsSync(join(root, '.lt-dev', 'ticket'))).toBe(true);
    });
  });

  describe('checkGlobalSetupTicketSafe', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lt-ticket-gs-'));
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'svl' }));
      mkdirSync(join(root, 'projects', 'api'), { recursive: true });
      mkdirSync(join(root, 'projects', 'app'), { recursive: true });
    });
    afterEach(() => rmSync(root, { force: true, recursive: true }));

    const layoutFor = (r: string) => ({
      apiDir: join(r, 'projects', 'api'),
      appDir: join(r, 'projects', 'app'),
      root: r,
      workspace: true,
    });

    test('no global-setup file → file: null, hasDbReset: false, ticketSafe: true', () => {
      const r = checkGlobalSetupTicketSafe(layoutFor(root));
      expect(r.file).toBeNull();
      expect(r.hasDbReset).toBe(false);
      expect(r.ticketSafe).toBe(true);
    });

    test('file present but no DB-reset markers → hasDbReset: false, ticketSafe: true', () => {
      const gsDir = join(root, 'projects', 'app', 'tests');
      mkdirSync(gsDir, { recursive: true });
      writeFileSync(join(gsDir, 'global-setup.ts'), `export default async function () { /* noop */ }\n`);
      const r = checkGlobalSetupTicketSafe(layoutFor(root));
      expect(r.file).toBe(join(gsDir, 'global-setup.ts'));
      expect(r.hasDbReset).toBe(false);
      expect(r.ticketSafe).toBe(true);
    });

    test('permissive allow-list (svl reference) → ticketSafe: true', () => {
      // Synthetic DB samples are `<base>-tkprobe-test[-2]`, where <base> is the
      // project slug ("svl" from package.json). Mirror the real svl pattern:
      //   /^<base>-(?:[a-z0-9-]+-)?test(?:-\d+)?$/
      const gsDir = join(root, 'projects', 'app', 'tests');
      mkdirSync(gsDir, { recursive: true });
      writeFileSync(
        join(gsDir, 'global-setup.ts'),
        [
          "import { MongoClient } from 'mongodb';",
          'function isAllowedDb(name: string) {',
          '  return /^svl-(?:[a-z0-9-]+-)?test(?:-\\d+)?$/.test(name);',
          '}',
          'export default async function () {',
          '  const uri = process.env.MONGO_URI!;',
          '  await new MongoClient(uri).db().dropDatabase();',
          '}',
        ].join('\n'),
      );
      const r = checkGlobalSetupTicketSafe(layoutFor(root));
      expect(r.hasDbReset).toBe(true);
      expect(r.ticketSafe).toBe(true);
    });

    test('shard-only allow-list (rejects ticket DBs) → ticketSafe: false', () => {
      // `svl-2200-test` is rejected by `^svl-test(?:-\d+)?$`; `lt dev doctor` must
      // WARN so the project broadens the allow-list before ticket E2E can run.
      const gsDir = join(root, 'projects', 'app', 'tests');
      mkdirSync(gsDir, { recursive: true });
      writeFileSync(
        join(gsDir, 'global-setup.ts'),
        [
          'function isAllowedDb(name: string) {',
          '  return /^svl-test(?:-\\d+)?$/.test(name);',
          '}',
          'export default async function () {',
          '  const uri = process.env.MONGO_URI!;',
          '  // dbNameFromUri + dropDatabase pattern',
          '  await drop(uri);',
          '}',
        ].join('\n'),
      );
      const r = checkGlobalSetupTicketSafe(layoutFor(root));
      expect(r.hasDbReset).toBe(true);
      expect(r.ticketSafe).toBe(false);
    });

    test('non-regex `/…/` (e.g. a division) does not crash the scanner', () => {
      const gsDir = join(root, 'projects', 'app', 'tests');
      mkdirSync(gsDir, { recursive: true });
      writeFileSync(
        join(gsDir, 'global-setup.ts'),
        [
          'function isAllowedDb(name: string) {',
          '  const half = 100 / 2; // looks like a regex literal to a naive scanner',
          '  return /^svl-(?:[a-z0-9-]+-)?test$/.test(name) && half > 0;',
          '}',
          'export default async function () {',
          '  await emptyDatabase();',
          '}',
        ].join('\n'),
      );
      const r = checkGlobalSetupTicketSafe(layoutFor(root));
      expect(r.hasDbReset).toBe(true);
      expect(r.ticketSafe).toBe(true);
    });

    test('falls back to <root>/tests/global-setup.ts when no appDir candidate exists', () => {
      const gsDir = join(root, 'tests');
      mkdirSync(gsDir, { recursive: true });
      writeFileSync(
        join(gsDir, 'global-setup.ts'),
        // No allow-list at all → still has DB reset, but ticket-unsafe by default.
        `export default async function () { await deleteMany({}); }\n`,
      );
      const r = checkGlobalSetupTicketSafe({ ...layoutFor(root), appDir: null });
      expect(r.file).toBe(join(gsDir, 'global-setup.ts'));
      expect(r.hasDbReset).toBe(true);
      expect(r.ticketSafe).toBe(false);
    });
  });
});

describe('dev-ticket — git-backed worktree + safety helpers', () => {
  // A real temp repo with a bare "origin" so `origin/dev` exists (needed for the
  // worktree base ref + the unpushed-commit check).
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  let remote: string;
  let repo: string;
  let wt: string;

  beforeEach(() => {
    remote = mkdtempSync(join(tmpdir(), 'lt-remote-'));
    repo = mkdtempSync(join(tmpdir(), 'lt-repo-'));
    wt = `${repo}-wt`; // sibling path that does NOT exist yet (git worktree add creates it)
    git(remote, 'init', '-q', '--bare');
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'ci@lenne.tech');
    git(repo, 'config', 'user.name', 'ci');
    git(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), '# repo\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'branch', '-M', 'dev'); // default branch → dev
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'dev'); // origin/dev now exists
  });

  afterEach(() => {
    try {
      git(repo, 'worktree', 'remove', '--force', wt);
    } catch {
      /* no worktree added in this test */
    }
    for (const d of [wt, repo, remote]) {
      try {
        rmSync(d, { force: true, recursive: true });
      } catch {
        /* ignore */
      }
    }
  });

  test('gitMainRepoRoot resolves the main repo — also from inside a worktree', () => {
    expect(realpathSync(gitMainRepoRoot(repo))).toBe(realpathSync(repo));
    worktreeAdd(repo, wt, 'feat/x', 'origin/dev');
    expect(realpathSync(gitMainRepoRoot(wt))).toBe(realpathSync(repo)); // shared .git → main repo
  });

  test('gitBranchExists', () => {
    expect(gitBranchExists(repo, 'dev')).toBe(true);
    expect(gitBranchExists(repo, 'does-not-exist')).toBe(false);
  });

  test('worktreeAdd → listWorktrees → worktreeRemove', () => {
    worktreeAdd(repo, wt, 'feat/DEV-2200', 'origin/dev');
    const entry = listWorktrees(repo).find((w) => realpathSync(w.path) === realpathSync(wt));
    expect(entry).toBeTruthy();
    expect(entry!.branch).toBe('feat/DEV-2200');
    worktreeRemove(repo, wt);
    expect(listWorktrees(repo).some((w) => w.path === wt)).toBe(false);
  });

  test('worktreeDirtyOnlyGenerated: clean=false · only generated=true · real source=false', () => {
    expect(worktreeDirtyOnlyGenerated(repo)).toBe(false); // clean → no force needed
    writeFileSync(join(repo, '.nuxtrc'), 'x');
    expect(worktreeDirtyOnlyGenerated(repo)).toBe(true); // only a framework-generated file
    writeFileSync(join(repo, 'feature.ts'), 'x');
    expect(worktreeDirtyOnlyGenerated(repo)).toBe(false); // a real source change is present
  });

  test('worktreeSafetyReport: pushed+clean → safe; uncommitted source / unpushed commit → flagged', () => {
    let r = worktreeSafetyReport(repo);
    expect(r.dirtySource).toEqual([]);
    expect(r.unpushed).toBe(0); // HEAD == origin/dev

    writeFileSync(join(repo, 'feature.ts'), 'x'); // uncommitted SOURCE change
    r = worktreeSafetyReport(repo);
    expect(r.dirtySource.length).toBe(1);

    rmSync(join(repo, 'feature.ts'));
    writeFileSync(join(repo, '.nuxtrc'), 'x'); // generated only → NOT counted as source
    expect(worktreeSafetyReport(repo).dirtySource).toEqual([]);
    rmSync(join(repo, '.nuxtrc'));

    writeFileSync(join(repo, 'b.md'), 'b'); // a committed-but-unpushed commit
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'wip');
    expect(worktreeSafetyReport(repo).unpushed).toBe(1);
  });

  test('a pristine lt-dev self-heal patch is auto-discardable; a real edit on top is not', () => {
    // Commit a legacy API config with a hardcoded port (the unmigrated state).
    mkdirSync(join(repo, 'projects', 'api', 'src'), { recursive: true });
    const cfg = join(repo, 'projects', 'api', 'src', 'config.env.ts');
    writeFileSync(cfg, 'export const config = {\n  port: 3000,\n};\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'add config');
    git(repo, 'push', '-q', 'origin', 'dev');

    // `lt dev up`'s autoPatch env-aware's it → the file is now dirty.
    expect(patchApiConfig(cfg).patched).toBe(true);
    expect(readFileSync(cfg, 'utf8')).toContain('Number(process.env.PORT)');

    // Pristine lt-dev patch → NOT counted as real source; worktree auto-discardable.
    expect(worktreeSafetyReport(repo).dirtySource).toEqual([]);
    expect(worktreeDirtyOnlyAutoDiscardable(repo)).toBe(true);

    // A developer edit ON TOP of the patch → real work, blocks auto-discard.
    writeFileSync(cfg, `${readFileSync(cfg, 'utf8').replace('};', "  host: 'x',\n};")}`);
    expect(worktreeSafetyReport(repo).dirtySource.length).toBe(1);
    expect(worktreeDirtyOnlyAutoDiscardable(repo)).toBe(false);

    // A real edit to a DIFFERENT tracked file also blocks (config reverted first).
    git(repo, 'checkout', '--', cfg);
    writeFileSync(join(repo, 'feature.ts'), 'x');
    expect(worktreeDirtyOnlyAutoDiscardable(repo)).toBe(false);
  });
});

// Regression: an older project still carrying the template's `lt-monorepo`
// package.json name must derive its slug from the project FOLDER (`imo`), and a
// ticket worktree of it (`imo-2314/`) must resolve to a SINGLE-suffixed slug
// (`imo-2314`), never `lt-monorepo-2314` and never the double-suffixed
// `imo-2314-2314`. This is the bug that made `lt ticket start DEV-2314` in an
// `imo/` project create `lt-monorepo-2314.localhost`.
describe('dev-ticket — slug for a worktree of an unrenamed lt-monorepo project', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  let parent: string;
  let main: string;
  let wt: string;

  beforeEach(() => {
    parent = realpathSync(mkdtempSync(join(tmpdir(), 'lt-imo-')));
    main = join(parent, 'imo');
    wt = join(parent, 'imo-2314'); // sibling worktree, created by `git worktree add`
    mkdirSync(main);
    writeFileSync(join(main, 'package.json'), JSON.stringify({ name: 'lt-monorepo' }));
    mkdirSync(join(main, 'projects', 'api'), { recursive: true });
    mkdirSync(join(main, 'projects', 'app'), { recursive: true });
    // git does not track empty dirs — a placeholder ensures the worktree
    // checkout actually contains projects/api + projects/app (so buildIdentity
    // detects the api/app subdomains there too).
    writeFileSync(join(main, 'projects', 'api', '.gitkeep'), '');
    writeFileSync(join(main, 'projects', 'app', '.gitkeep'), '');
    git(main, 'init', '-q');
    git(main, 'config', 'user.email', 'ci@lenne.tech');
    git(main, 'config', 'user.name', 'ci');
    git(main, 'config', 'commit.gpgsign', 'false');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'init');
    git(main, 'branch', '-M', 'dev');
  });

  afterEach(() => {
    try {
      git(main, 'worktree', 'remove', '--force', wt);
    } catch {
      /* no worktree in this test */
    }
    rmSync(parent, { force: true, recursive: true });
  });

  const layoutFor = (r: string) => ({
    apiDir: join(r, 'projects', 'api'),
    appDir: join(r, 'projects', 'app'),
    root: r,
    workspace: true,
  });

  test('base project slugs to the folder name, not the template placeholder', () => {
    expect(buildIdentity(main).slug).toBe('imo');
  });

  test('worktree inherits the base slug (no double-suffix)', () => {
    worktreeAdd(main, wt, 'feat/DEV-2314', 'dev');
    // The worktree folder is `imo-2314`, but its slug must still be `imo`.
    expect(buildIdentity(wt).slug).toBe('imo');

    writeTicketMarker(wt, '2314');
    const res = resolveDevIdentity(layoutFor(wt));
    expect(res.ticket).toBe('2314');
    expect(res.identity.slug).toBe('imo-2314'); // NOT imo-2314-2314, NOT lt-monorepo-2314
    expect(res.identity.subdomains.app.hostname).toBe('imo-2314.localhost');
    expect(res.identity.subdomains.api.hostname).toBe('api.imo-2314.localhost');
  });
});

// Regression: `lt ticket start` hard-coded `origin/dev` as the base ref, so it
// died with "fatal: invalid reference: origin/dev" in every repo that names its
// integration branch differently — e.g. nest-server, which uses `develop`.
describe('dev-ticket — base ref resolution', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const dirs: string[] = [];

  /** A repo whose remote carries exactly the given branches (first = default). */
  const repoWithRemoteBranches = (branches: string[]): string => {
    const remote = mkdtempSync(join(tmpdir(), 'lt-baseref-remote-'));
    const repo = mkdtempSync(join(tmpdir(), 'lt-baseref-repo-'));
    dirs.push(remote, repo);
    git(remote, 'init', '-q', '--bare');
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'ci@lenne.tech');
    git(repo, 'config', 'user.name', 'ci');
    git(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), '# repo\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'branch', '-M', branches[0]);
    git(repo, 'remote', 'add', 'origin', remote);
    for (const b of branches.slice(1)) git(repo, 'branch', b);
    for (const b of branches) git(repo, 'push', '-q', 'origin', b);
    // Only the remote branches must decide — drop the local ones (except the
    // checked-out default) so the candidate order is actually exercised.
    for (const b of branches.slice(1)) git(repo, 'branch', '-D', b);
    return repo;
  };

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { force: true, recursive: true });
      } catch {
        /* ignore */
      }
    }
  });

  test('prefers origin/dev when it exists', () => {
    const repo = repoWithRemoteBranches(['dev', 'develop', 'main']);
    expect(resolveBaseRef(repo).ref).toBe('origin/dev');
  });

  test('falls back to origin/develop (the nest-server case — no dev branch)', () => {
    const repo = repoWithRemoteBranches(['develop']);
    const res = resolveBaseRef(repo);
    expect(res.ref).toBe('origin/develop');
    expect(res.explicit).toBe(false);
    expect(res.candidates).toContain('origin/dev'); // probed first, just absent
  });

  test('falls back to origin/main when neither dev nor develop exists', () => {
    const repo = repoWithRemoteBranches(['main']);
    expect(resolveBaseRef(repo).ref).toBe('origin/main');
  });

  test('falls back to a LOCAL branch in a repo without a remote', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lt-baseref-local-'));
    dirs.push(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'ci@lenne.tech');
    git(repo, 'config', 'user.name', 'ci');
    git(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), '# repo\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'branch', '-M', 'develop');
    expect(resolveBaseRef(repo).ref).toBe('develop');
  });

  test('ref is null when nothing matches → the command asks the user', () => {
    const repo = repoWithRemoteBranches(['trunk']);
    const res = resolveBaseRef(repo);
    expect(res.ref).toBeNull();
    // `trunk` is still offered as a choice in the interactive prompt.
    expect(listBaseRefChoices(repo)).toContain('origin/trunk');
    expect(listBaseRefChoices(repo).some((c) => c.endsWith('/HEAD'))).toBe(false);
  });

  test('an explicit --base wins, and is reported as missing when it does not exist', () => {
    const repo = repoWithRemoteBranches(['dev', 'release']);
    expect(resolveBaseRef(repo, 'origin/release')).toEqual({
      candidates: ['origin/release'],
      explicit: true,
      ref: 'origin/release',
    });
    expect(resolveBaseRef(repo, 'origin/nope').ref).toBeNull(); // no silent fall-back to origin/dev
  });

  test('gitRefExists resolves branches, tags and shas — not typos', () => {
    const repo = repoWithRemoteBranches(['dev']);
    git(repo, 'tag', 'v1.0.0');
    expect(gitRefExists(repo, 'origin/dev')).toBe(true);
    expect(gitRefExists(repo, 'v1.0.0')).toBe(true);
    expect(gitRefExists(repo, 'origin/typo')).toBe(false);
  });
});

/** Minimal project dir → a real DevIdentity via buildIdentity (api + app subdomains). */
function buildIdentityFixture(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lt-ticket-fixture-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
  mkdirSync(join(dir, 'projects', 'api'), { recursive: true });
  mkdirSync(join(dir, 'projects', 'app'), { recursive: true });
  const identity = buildIdentity(dir);
  rmSync(dir, { force: true, recursive: true });
  return identity;
}
