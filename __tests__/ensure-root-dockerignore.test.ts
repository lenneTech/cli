import { ensureRootDockerignore } from '../src/lib/ensure-root-dockerignore';

const { filesystem } = require('gluegun');

/**
 * Docker only reads `.dockerignore` from the build context root, and its
 * patterns are resolved against that root. A bare `node_modules` therefore does
 * NOT cover `projects/app/node_modules` — the reason every required pattern
 * here carries a globstar prefix.
 */
describe('ensureRootDockerignore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      filesystem.cwd(),
      '__tests__',
      'temp-dockerignore-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    );
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    if (filesystem.exists(tempDir)) {
      filesystem.remove(tempDir);
    }
  });

  const read = (): string => filesystem.read(`${tempDir}/.dockerignore`) || '';

  it('creates the file with every required pattern when none exists', () => {
    const result = ensureRootDockerignore({ filesystem, projectDir: tempDir });

    expect(result.created).toBe(true);
    const content = read();
    for (const pattern of ['**/node_modules', '**/.output', '**/.nuxt', '**/.env', '.git']) {
      expect(content).toContain(pattern);
    }
  });

  it('ignores every .env variant (incl. .env.production) but keeps .env.example via negation', () => {
    ensureRootDockerignore({ filesystem, projectDir: tempDir });
    const patterns = read()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    expect(patterns).toContain('**/.env');
    // `**/.env.*` covers .env.production / .env.staging / .env.test (secrets).
    expect(patterns).toContain('**/.env.*');
    // The negation re-includes the safe placeholder — and must come AFTER the
    // broad glob so it actually wins in Docker's last-match-wins evaluation.
    expect(patterns).toContain('!**/.env.example');
    expect(patterns.indexOf('!**/.env.example')).toBeGreaterThan(patterns.indexOf('**/.env.*'));
  });

  it('ignores session logs + the .lt-dev ENV bridge', () => {
    ensureRootDockerignore({ filesystem, projectDir: tempDir });
    const content = read();

    expect(content).toContain('**/.lt-dev');
    expect(content).toContain('**/*.log');
  });

  it('upgrades an existing file whose bare patterns do not match sub-projects', () => {
    filesystem.write(`${tempDir}/.dockerignore`, 'node_modules\n.output\n.git\n');

    const result = ensureRootDockerignore({ filesystem, projectDir: tempDir });

    expect(result.created).toBe(false);
    // `.git` already matched exactly, so it must not be appended again.
    expect(result.added).not.toContain('.git');
    expect(result.added).toContain('**/node_modules');
    expect(result.added).toContain('**/.output');

    const content = read();
    // The project's own lines survive untouched, as their own lines.
    expect(content).toMatch(/^node_modules$/m);
    expect(content).toMatch(/^\*\*\/node_modules$/m);
    expect(content.match(/^\.git$/gm)).toHaveLength(1);
  });

  it('is idempotent', () => {
    ensureRootDockerignore({ filesystem, projectDir: tempDir });
    const afterFirst = read();

    const second = ensureRootDockerignore({ filesystem, projectDir: tempDir });

    expect(second.created).toBe(false);
    expect(second.added).toEqual([]);
    expect(read()).toBe(afterFirst);
  });

  it('does not treat commented-out patterns as present', () => {
    filesystem.write(`${tempDir}/.dockerignore`, '# **/node_modules\n');

    const result = ensureRootDockerignore({ filesystem, projectDir: tempDir });

    expect(result.added).toContain('**/node_modules');
  });

  it('appends a trailing newline before the managed block when the file lacks one', () => {
    filesystem.write(`${tempDir}/.dockerignore`, 'coverage');

    ensureRootDockerignore({ filesystem, projectDir: tempDir });

    expect(read()).toMatch(/^coverage\n/);
    expect(read()).toContain('**/node_modules');
  });
});
