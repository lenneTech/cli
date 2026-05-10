import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const REGISTRY_TMP = mkdtempSync(join(tmpdir(), 'lt-dev-migrate-helper-'));
process.env.LT_DEV_REGISTRY_PATH = join(REGISTRY_TMP, 'projects.json');

import { runMigrate } from '../src/lib/dev-migrate-helper';
import { DevProjectLayout } from '../src/lib/dev-project';

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
    expect(r.codePatches).toEqual([]); // already env-aware
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
});
