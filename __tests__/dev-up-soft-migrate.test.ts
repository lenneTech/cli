/**
 * `lt dev up` performs sanft auto-migration of safe operations
 * (CLAUDE.md URL block + .gitignore entry) before spawning processes.
 * It also detects legacy hardcoded ports and warns without auto-patching.
 *
 * Spawning + Caddy interactions are out of scope here — we test the
 * library functions that `up` calls in its preflight phase.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildIdentity } from '../src/lib/dev-identity';
import { addToGitignore, patchClaudeMd } from '../src/lib/dev-patches';
import { apiNeedsPortPatch, appNeedsPortPatch, deriveDbName, DevProjectLayout } from '../src/lib/dev-project';

describe('dev up — soft auto-migration (preflight library calls)', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'lt-dev-up-soft-'));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('CLAUDE.md gets URL block when it exists; gitignore gets `.lt-dev/`', () => {
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'src', 'config.env.ts'), 'port: Number(process.env.PORT) || 3000,');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'crm' }));
    writeFileSync(join(project, 'CLAUDE.md'), '# project\n');

    const layout: DevProjectLayout = { apiDir: project, appDir: null, root: project, workspace: false };
    const identity = buildIdentity(project);
    const dbName = deriveDbName(layout.apiDir, identity.slug);

    // Mirror what `up` does in its preflight:
    const claudeResult = patchClaudeMd(join(project, 'CLAUDE.md'), { dbName, identity });
    const gitignoreAdded = addToGitignore(project, '.lt-dev/');

    expect(claudeResult.patched).toBe(true);
    expect(gitignoreAdded).toBe(true);
    expect(readFileSync(join(project, 'CLAUDE.md'), 'utf8')).toContain('https://api.crm.localhost');
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toContain('.lt-dev/');
  });

  test('legacy hardcoded ports are detected (no auto-patch — warning only)', () => {
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'src', 'config.env.ts'), '    port: 3000,');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'legacy' }));

    const file = apiNeedsPortPatch(project);
    expect(file).toBe(join(project, 'src', 'config.env.ts'));

    // Verify file is NOT modified by the detection alone
    expect(readFileSync(join(project, 'src', 'config.env.ts'), 'utf8')).toContain('port: 3000');
    expect(readFileSync(join(project, 'src', 'config.env.ts'), 'utf8')).not.toContain('process.env.PORT');
  });

  test('detects nuxt + playwright legacy patterns simultaneously', () => {
    writeFileSync(join(project, 'nuxt.config.ts'), "    port: 3001,\n    target: 'http://localhost:3000',\n");
    writeFileSync(join(project, 'playwright.config.ts'), "    baseURL: 'http://localhost:3001',\n");
    const files = appNeedsPortPatch(project);
    expect(files.length).toBe(2);
  });

  test('idempotent: re-running soft-migrate does not duplicate CLAUDE.md block', () => {
    writeFileSync(join(project, 'CLAUDE.md'), '# project\n');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'idem' }));
    const identity = buildIdentity(project);
    patchClaudeMd(join(project, 'CLAUDE.md'), { identity });
    patchClaudeMd(join(project, 'CLAUDE.md'), { identity });
    const matches = (readFileSync(join(project, 'CLAUDE.md'), 'utf8').match(/<!-- lt-dev:url-block:start -->/g) || [])
      .length;
    expect(matches).toBe(1);
  });

  test('gitignore add is idempotent', () => {
    writeFileSync(join(project, '.gitignore'), 'node_modules/\n.lt-dev/\n');
    const added = addToGitignore(project, '.lt-dev/');
    expect(added).toBe(false);
  });

  test('soft-migrate skips CLAUDE.md when file does not exist', () => {
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'no-claude' }));
    const identity = buildIdentity(project);
    const r = patchClaudeMd(join(project, 'CLAUDE.md'), { identity });
    expect(r.patched).toBe(false);
    expect(existsSync(join(project, 'CLAUDE.md'))).toBe(false); // never created
  });
});
