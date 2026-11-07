import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { filesystem } from 'gluegun';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { FrontendHelper } from '../src/extensions/frontend-helper';

/**
 * Which nuxt-extensions `lt fullstack init`, `add-app` and `lt frontend nuxt` vendor. Without an
 * explicit ref it used to be the default branch, so every project created between a merge and
 * its release got unreleased work. Now it is the tag of the version the app pins, as for
 * nest-server and ng-base, and a pin without a tag is an error, never the default branch.
 *
 * The upstream is a local fixture repository: tag `1.0.0` holds the release, `main` one more
 * commit nobody released.
 */

// The fixture repository is created with the ambient environment. With a GIT_DIR inherited from
// a hook or `git rebase -x` in a linked worktree, `git init` would re-initialise the repository
// the suite was started from.
const HOOK_GIT_VARIABLES = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'];
const savedGitEnv: Record<string, string | undefined> = {};

let root: string;
let upstream: string;
let warnings: string[];

const git = (...args: string[]): string =>
  execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Commits a nuxt-extensions release state into the fixture upstream, optionally tagged. */
function commitRelease(version: string, tag?: string): void {
  write(join(upstream, 'package.json'), `${JSON.stringify({ name: '@lenne.tech/nuxt-extensions', version })}\n`);
  write(join(upstream, 'src', 'module.ts'), `export const release = '${version}';\n`);
  write(join(upstream, 'src', 'runtime', 'composables', 'use-release.ts'), `export const useRelease = () => '${version}';\n`);
  git('add', '-A');
  git('-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '-m', version);
  if (tag) {
    git('tag', tag);
  }
}

/** An npm-mode Nuxt app that pins nuxt-extensions with `spec`. */
function makeApp(spec: string): string {
  const app = join(root, 'app');
  write(
    join(app, 'package.json'),
    `${JSON.stringify({ dependencies: { '@lenne.tech/nuxt-extensions': spec, nuxt: '4.2.0' }, name: 'app' }, null, 2)}\n`,
  );
  write(join(app, 'nuxt.config.ts'), "export default defineNuxtConfig({ modules: ['@lenne.tech/nuxt-extensions'] });\n");
  return app;
}

function makeHelper(): FrontendHelper {
  const print = { error: () => {}, info: () => {}, success: () => {}, warning: (m: string) => warnings.push(m) };
  return new FrontendHelper({ filesystem, print } as never);
}

function vendoredRelease(app: string): string {
  return readFileSync(join(app, 'app', 'core', 'module.ts'), 'utf8');
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

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

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lt-nuxt-ext-ref-')));
  upstream = join(root, 'nuxt-extensions');
  mkdirSync(upstream);
  git('init', '--quiet', '--initial-branch', 'main');
  commitRelease('1.0.0', '1.0.0');
  commitRelease('1.1.0-unreleased');
  warnings = [];
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('convertAppCloneToVendored: which nuxt-extensions is vendored', () => {
  const upstreamRepoUrl = (): string => `file://${upstream}`;

  test.each(['1.0.0', '^1.0.0'])('a pin of %s vendors the tag 1.0.0, not the default branch', async (spec) => {
    const app = makeApp(spec);
    await makeHelper().convertAppCloneToVendored({ dest: app, upstreamRepoUrl: upstreamRepoUrl() });

    expect(vendoredRelease(app)).toContain("'1.0.0'");
    expect(readFileSync(join(app, 'app', 'core', 'VENDOR.md'), 'utf8')).toContain('**Baseline-Version:** 1.0.0');
  });

  test('a pinned version without a tag fails and vendors nothing, it never falls back to the default branch', async () => {
    const app = makeApp('2.0.0');
    const conversion = makeHelper().convertAppCloneToVendored({ dest: app, upstreamRepoUrl: upstreamRepoUrl() });

    await expect(conversion).rejects.toThrow(/has no tag "2\.0\.0": that version is not released/);
    expect(existsSync(join(app, 'app', 'core'))).toBe(false);
    expect(readFileSync(join(app, 'package.json'), 'utf8')).toContain('"@lenne.tech/nuxt-extensions": "2.0.0"');
  });

  test('an explicit ref wins over the pin', async () => {
    const app = makeApp('1.0.0');
    await makeHelper().convertAppCloneToVendored({ dest: app, upstreamBranch: 'main', upstreamRepoUrl: upstreamRepoUrl() });

    expect(vendoredRelease(app)).toContain("'1.1.0-unreleased'");
  });

  test('back to npm mode pins the vendored release exactly, never as a range', async () => {
    const app = makeApp('^1.0.0');
    const helper = makeHelper();
    await helper.convertAppCloneToVendored({ dest: app, upstreamRepoUrl: upstreamRepoUrl() });
    await helper.convertAppToNpmMode({ dest: app });

    const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@lenne.tech/nuxt-extensions']).toBe('1.0.0');
    expect(existsSync(join(app, 'app', 'core'))).toBe(false);
  });

  test('a spec that names no release vendors the default branch, with a warning', async () => {
    const app = makeApp('latest');
    await makeHelper().convertAppCloneToVendored({ dest: app, upstreamRepoUrl: upstreamRepoUrl() });

    expect(vendoredRelease(app)).toContain("'1.1.0-unreleased'");
    expect(warnings.join('\n')).toContain('no version pin in package.json — vendoring the default branch');
  });
});
