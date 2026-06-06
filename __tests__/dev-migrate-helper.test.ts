import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const REGISTRY_TMP = mkdtempSync(join(tmpdir(), 'lt-dev-migrate-helper-'));
process.env.LT_DEV_REGISTRY_PATH = join(REGISTRY_TMP, 'projects.json');

import { runMigrate } from '../src/lib/dev-migrate-helper';
import { DevProjectLayout } from '../src/lib/dev-project';

function buildMonorepoLikeRoot(root: string, opts: { pkgName: string }): DevProjectLayout {
  // Minimal lt-monorepo shape: projects/ dir with an api subproject so that
  // buildIdentity follows the monorepo branch and so deriveDbName has a
  // config to read.
  const apiDir = join(root, 'projects', 'api');
  mkdirSync(join(apiDir, 'src'), { recursive: true });
  writeFileSync(
    join(apiDir, 'src', 'config.env.ts'),
    `export default {\n  port: Number(process.env.PORT) || 3000,\n  dbName: 'kit-local',\n};`,
  );
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: opts.pkgName, version: '1.0.0' }));
  return { apiDir, appDir: null, root, workspace: true };
}

function buildStandaloneApi(root: string, opts: { hardcoded?: boolean; withClaude?: boolean } = {}): DevProjectLayout {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'config.env.ts'),
    opts.hardcoded
      ? `export default {\n  port: 3000,\n  dbName: 'svc-local',\n};`
      : `export default {\n  port: Number(process.env.PORT) || 3000,\n  dbName: 'svc-local',\n};`,
  );
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'svc' }));
  if (opts.withClaude) {
    writeFileSync(join(root, 'CLAUDE.md'), '# project notes\n');
  }
  return { apiDir: root, appDir: null, root, workspace: false };
}

describe('dev-migrate-helper / runMigrate', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'lt-dev-migrate-proj-'));
    writeFileSync(process.env.LT_DEV_REGISTRY_PATH!, JSON.stringify({ projects: {}, version: 1 }));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });
  afterAll(() => {
    rmSync(REGISTRY_TMP, { recursive: true, force: true });
  });

  test('first run on a fresh ENV-aware project: registers + adds gitignore + patches CLAUDE.md', () => {
    const layout = buildStandaloneApi(project, { withClaude: true });
    const r = runMigrate({ layout });

    expect(r.alreadyMigrated).toBe(false);
    expect(r.identity.slug).toBe('svc');
    expect(r.dbName).toBe('svc-local');
    // autoPatch now runs over every existing config file (idempotent); an
    // already-env-aware config.env.ts is visited but nothing is actually patched.
    expect(r.codePatches.every((p) => !p.patched)).toBe(true);
    expect(r.claudePatches.find((p) => p.patched)).toBeTruthy();
    expect(r.registryUpdated).toBe(true);
    expect(r.addedGitignoreEntry).toBe(true);
  });

  test('second run on the same project: alreadyMigrated=true, nothing changes', () => {
    const layout = buildStandaloneApi(project, { withClaude: true });
    runMigrate({ layout });
    const r = runMigrate({ layout });

    expect(r.alreadyMigrated).toBe(true);
    expect(r.registryUpdated).toBe(false);
    expect(r.addedGitignoreEntry).toBe(false);
    expect(r.claudePatches.find((p) => p.patched)).toBeFalsy();
  });

  test('legacy project with hardcoded port: codePatches reports patched file', () => {
    const layout = buildStandaloneApi(project, { hardcoded: true });
    const r = runMigrate({ layout });

    const patched = r.codePatches.find((p) => p.patched);
    expect(patched).toBeTruthy();
    expect(patched?.replacements).toBe(1);
    expect(readFileSync(join(project, 'src', 'config.env.ts'), 'utf8')).toContain(
      'port: Number(process.env.PORT) || 3000',
    );
  });

  test('does not create CLAUDE.md from scratch (only patches existing)', () => {
    const layout = buildStandaloneApi(project); // no CLAUDE.md
    const r = runMigrate({ layout });

    expect(r.claudePatches).toEqual([]);
  });

  test('idempotent registry: same path/dbName/subdomains → registryUpdated=false on re-run', () => {
    const layout = buildStandaloneApi(project);
    runMigrate({ layout });
    const r = runMigrate({ layout });

    expect(r.registryUpdated).toBe(false);
  });

  // The kit-style case: `git clone lenneTech/lt-monorepo kit` leaves the
  // root package.json with `"name": "lt-monorepo"`. Without correction,
  // `lt dev init` would slug to `lt-monorepo` and collide across every
  // template-cloned project. The migrate step must rewrite the name to
  // the directory basename, so the slug derives from the actual project.
  test('rewrites unmodified lt-monorepo package name to the slugified project directory basename', () => {
    const monorepo = mkdtempSync(join(tmpdir(), 'lt-kit-'));
    try {
      // mkdtemp appends a random suffix that may contain uppercase letters;
      // slugify lowercases it so the result matches what `dev-identity`
      // will read back when computing the slug.
      const expectedSlug = monorepo
        .split(/[\\/]/)
        .pop()!
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const layout = buildMonorepoLikeRoot(monorepo, { pkgName: 'lt-monorepo' });

      const r = runMigrate({ layout });

      expect(r.renamedTemplatePackage).toBe(expectedSlug);
      expect(r.identity.slug).toBe(expectedSlug);
      expect(JSON.parse(readFileSync(join(monorepo, 'package.json'), 'utf8')).name).toBe(expectedSlug);
      expect(r.alreadyMigrated).toBe(false);
    } finally {
      rmSync(monorepo, { recursive: true, force: true });
    }
  });

  test('leaves a customized package name untouched', () => {
    const monorepo = mkdtempSync(join(tmpdir(), 'lt-custom-'));
    try {
      const layout = buildMonorepoLikeRoot(monorepo, { pkgName: 'kit' });

      const r = runMigrate({ layout });

      expect(r.renamedTemplatePackage).toBeNull();
      expect(r.identity.slug).toBe('kit');
      expect(JSON.parse(readFileSync(join(monorepo, 'package.json'), 'utf8')).name).toBe('kit');
    } finally {
      rmSync(monorepo, { recursive: true, force: true });
    }
  });

  test('rename is idempotent — a second run reports renamedTemplatePackage=null', () => {
    const monorepo = mkdtempSync(join(tmpdir(), 'lt-idem-'));
    try {
      const layout = buildMonorepoLikeRoot(monorepo, { pkgName: 'lt-monorepo' });
      runMigrate({ layout });

      const r = runMigrate({ layout });

      expect(r.renamedTemplatePackage).toBeNull();
      expect(r.alreadyMigrated).toBe(true);
    } finally {
      rmSync(monorepo, { recursive: true, force: true });
    }
  });
});
