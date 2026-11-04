import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import {
  CHECK_WRAPPER_REPOSITORY,
  checkWrapperSource,
  fetchCheckWrapperRelease,
  latestReleaseTag,
  spawnedSiblings,
} from '../src/lib/check-wrapper-release';
import { healCheckWrapper } from '../src/lib/heal-check-wrapper';

/**
 * `lt fullstack update` and `lt dev doctor` take the check wrapper from the newest lt-monorepo
 * release. Every test runs against a local fixture repository: no test reaches GitHub (the setup
 * file points `LT_CHECK_WRAPPER_SOURCE` at a path that does not exist).
 */

// The fixture repositories are created and committed with the ambient environment. With a GIT_DIR
// inherited from a hook or `git rebase -x` in a linked worktree, `git init` re-initialises the
// repository the suite was started from, and the fixture commits and tags land there.
const HOOK_GIT_VARIABLES = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'];
const savedGitEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of HOOK_GIT_VARIABLES) {
    savedGitEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of HOOK_GIT_VARIABLES) {
    if (savedGitEnv[key] !== undefined) {
      process.env[key] = savedGitEnv[key];
    }
  }
});

describe('fetchCheckWrapperRelease', () => {
  let upstream: string;
  const fetched: { dispose: () => void }[] = [];

  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  /** Write files into the fixture upstream, commit them and optionally tag the commit. */
  const commit = (files: Record<string, null | string>, tag?: string): void => {
    for (const [name, content] of Object.entries(files)) {
      const file = join(upstream, name);
      if (content === null) {
        rmSync(file, { force: true });
      } else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
    }
    git('add', '-A');
    git('-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '-m', 'fixture');
    if (tag) {
      git('tag', tag);
    }
  };

  const wrapper = (version: string, body = ''): string => `#!/usr/bin/env node\n// @lt-check-wrapper ${version}\n${body}\n`;

  const fetchRelease = (): ReturnType<typeof fetchCheckWrapperRelease> => {
    const result = fetchCheckWrapperRelease({ source: upstream });
    if (result.release) {
      fetched.push(result.release);
    }
    return result;
  };

  beforeEach(() => {
    upstream = mkdtempSync(join(tmpdir(), 'lt-wrapper-upstream-'));
    execFileSync('git', ['init', '--quiet', upstream]);
    // Like lt-monorepo itself (`* text=auto eol=lf`): without it, the clone under
    // `core.autocrlf=true` (the Windows CI job) checks the fixture out with CRLF.
    writeFileSync(join(upstream, '.gitattributes'), '* text=auto eol=lf\n');
  });

  afterEach(() => {
    fetched.splice(0).forEach((release) => release.dispose());
    rmSync(upstream, { force: true, recursive: true });
  });

  it('checks out the newest release tag, compared numerically, not the newest commit', () => {
    commit({ 'scripts/check.mjs': wrapper('3.9.0', 'console.log("3.9");') }, 'v3.9.0');
    commit({ 'scripts/check.mjs': wrapper('3.10.0', 'console.log("3.10");') }, 'v3.10.0');
    // main moves on after the release and still carries its marker.
    commit({ 'scripts/check.mjs': wrapper('3.10.0', 'console.log("main after 3.10");') });

    const { error, release } = fetchRelease();

    expect(error).toBeNull();
    expect(release?.tag).toBe('v3.10.0');
    expect(release?.version).toBe('3.10.0');
    expect(readFileSync(release!.assetPath, 'utf8')).toContain('console.log("3.10");');
  });

  it('ignores prerelease and non-version tags', () => {
    expect(latestReleaseTag(['v3.17.2', 'v3.18.0-rc.1', 'latest', '3.19.0', 'v3.17.10'])).toBe('v3.17.10');
    expect(latestReleaseTag(['latest', 'v1.0.0-rc.1'])).toBeNull();
  });

  it('brings the import closure of the release along', () => {
    commit(
      {
        'scripts/build-test-gate.mjs': 'export const g = 1;\n',
        'scripts/check.mjs': wrapper('3.17.2', "import { g } from './build-test-gate.mjs';"),
      },
      'v3.17.2',
    );
    const project = mkdtempSync(join(tmpdir(), 'lt-wrapper-project-'));
    try {
      writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { check: 'pnpm -r run check' } }));
      const { release } = fetchRelease();

      expect(healCheckWrapper(project, release!.assetPath)).toEqual([
        'scripts/check.mjs',
        'scripts/build-test-gate.mjs',
        'package.json',
      ]);
      expect(readFileSync(join(project, 'scripts', 'build-test-gate.mjs'), 'utf8')).toBe('export const g = 1;\n');
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });

  it('refuses a release whose marker is not its tag', () => {
    commit({ 'scripts/check.mjs': wrapper('3.17.1') }, 'v3.17.2');

    const { error, release } = fetchRelease();

    expect(release).toBeNull();
    expect(error).toMatch(/v3\.17\.2: scripts\/check\.mjs carries the marker 3\.17\.1, not 3\.17\.2/);
  });

  it('refuses a release without a wrapper', () => {
    commit({ 'README.md': 'no wrapper here\n' }, 'v1.0.0');
    expect(fetchRelease().error).toMatch(/v1\.0\.0: scripts\/check\.mjs not found/);
  });

  it('refuses a release whose wrapper starts a sibling it does not import', () => {
    // resolveCopySet follows imports. A `node scripts/x.mjs` is invisible to it, so the file
    // would never reach the project and its `check` would break there.
    commit(
      {
        'scripts/check.mjs': wrapper('3.17.2', "execFileSync('node', ['scripts/remove.mjs', 'node_modules']);"),
        'scripts/remove.mjs': 'export const removed = true;\n',
      },
      'v3.17.2',
    );

    const { error, release } = fetchRelease();

    expect(release).toBeNull();
    expect(error).toMatch(/the wrapper starts remove\.mjs without importing it/);
  });

  it('reports a repository without a release tag', () => {
    commit({ 'scripts/check.mjs': wrapper('3.17.2') });
    expect(fetchRelease().error).toMatch(/has no release tag \(vX\.Y\.Z\)/);
  });

  it('reports an unreachable source instead of reading it as "no tags"', () => {
    const { error, release } = fetchCheckWrapperRelease({ source: join(upstream, 'missing') });

    expect(release).toBeNull();
    expect(error).toMatch(/is not reachable \(/);
  });

  it('removes the checkout on dispose', () => {
    commit({ 'scripts/check.mjs': wrapper('3.17.2') }, 'v3.17.2');
    const { release } = fetchCheckWrapperRelease({ source: upstream });
    const checkout = dirname(dirname(release!.assetPath));

    release!.dispose();

    expect(existsSync(checkout)).toBe(false);
  });

  it('reads the source from LT_CHECK_WRAPPER_SOURCE, else GitHub', () => {
    const saved = process.env.LT_CHECK_WRAPPER_SOURCE;
    try {
      process.env.LT_CHECK_WRAPPER_SOURCE = upstream;
      expect(checkWrapperSource()).toBe(upstream);
      delete process.env.LT_CHECK_WRAPPER_SOURCE;
      expect(checkWrapperSource()).toBe(`https://github.com/${CHECK_WRAPPER_REPOSITORY}.git`);
    } finally {
      process.env.LT_CHECK_WRAPPER_SOURCE = saved;
    }
  });
});

describe('spawnedSiblings', () => {
  let scriptsDir: string;

  beforeEach(() => {
    scriptsDir = mkdtempSync(join(tmpdir(), 'lt-wrapper-scripts-'));
  });

  afterEach(() => {
    rmSync(scriptsDir, { force: true, recursive: true });
  });

  it('catches every call shape, and never the wrapper itself', () => {
    writeFileSync(
      join(scriptsDir, 'check.mjs'),
      [
        '// @lt-check-wrapper 3.13.1',
        "spawn('node', ['scripts/watchdog.mjs']);",
        "await run('node ./scripts/seed.mjs --force');",
        "execSync('bash scripts/mongo-watchdog.sh');",
        '// a mention of scripts/check.mjs itself must not count',
      ].join('\n'),
    );

    expect(spawnedSiblings(scriptsDir, ['check.mjs'])).toEqual(['mongo-watchdog.sh', 'seed.mjs', 'watchdog.mjs']);
  });

  it('skips comment lines: the wrapper documents its own behaviour in backtick prose', () => {
    writeFileSync(
      join(scriptsDir, 'check.mjs'),
      "// @lt-check-wrapper 3.13.1\n/**\n * runs `bash scripts/audit.sh` first\n */\n// `node scripts/x.mjs`\n",
    );

    expect(spawnedSiblings(scriptsDir, ['check.mjs'])).toEqual([]);
  });
});
