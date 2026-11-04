/**
 * Where `lt fullstack update` and `lt dev doctor` get the check wrapper from: the newest
 * lt-monorepo RELEASE, fetched at run time.
 *
 * lt-monorepo is the upstream of `scripts/check.mjs`. The CLI used to ship a pinned copy, which
 * reached projects only with the next CLI release: every lt-monorepo release needed a CLI patch
 * release, and in between `lt fullstack init` (which clones lt-monorepo) and `lt fullstack update`
 * (which installed the copy) put two different versions into projects. Comparing the project's
 * `@lt-check-wrapper` marker with the newest release tag needs no copy at all.
 *
 * A release TAG, never `main`: between releases `main` still carries the marker of the last
 * release while its content may already differ, so only a tag names exactly one content.
 *
 * Fails closed. An unreachable remote, no release tag, a marker that does not match its tag, or a
 * sibling the wrapper starts but does not import: the caller gets `release: null` plus an `error`,
 * and the project keeps its wrapper.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';

import { compareVersions, readWrapperVersion, resolveCopySet } from './heal-check-wrapper';

/** A release of the check wrapper, checked out into a temporary directory. */
export interface CheckWrapperRelease {
  /** Absolute path of `scripts/check.mjs` in the checkout. */
  assetPath: string;
  /** Removes the checkout. Call it once heal or doctor is done with the files. */
  dispose: () => void;
  /** The release tag, e.g. `v3.17.2`. */
  tag: string;
  /** The release version, e.g. `3.17.2`. Equal to the wrapper's marker. */
  version: string;
}

/**
 * Exactly one of the two fields is set. Not a discriminated union: this repo's tsconfig has no
 * `strictNullChecks`, so TypeScript would not narrow it.
 */
export interface CheckWrapperReleaseResult {
  error: null | string;
  release: CheckWrapperRelease | null;
}

export interface FetchCheckWrapperOptions {
  /** Git URL or local path. Default: `checkWrapperSource()`. */
  source?: string;
}

export const CHECK_WRAPPER_REPOSITORY = 'lenneTech/lt-monorepo';

const DEFAULT_SOURCE = `https://github.com/${CHECK_WRAPPER_REPOSITORY}.git`;

/** Release tags only: `v3.17.2`, not `v3.18.0-rc.1` and not `latest`. */
const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/;

/** Both network calls must end: an offline `lt fullstack update` must not hang on git. */
const LS_REMOTE_TIMEOUT_MS = 20_000;
const CLONE_TIMEOUT_MS = 60_000;

/**
 * A sibling script the wrapper SPAWNS rather than imports.
 *
 * `resolveCopySet` follows imports, so a `node scripts/x.mjs` — or a spawn/execFile with such a
 * path — is invisible to it: the file is never installed, and only the project's `check` breaks.
 * Matched on the path inside a STRING rather than on the call shape, so
 * `spawn('node', ['scripts/x.mjs'])`, `execSync('bash scripts/x.sh')` and a bare
 * `'scripts/x.mjs'` are all covered.
 *
 * Comment LINES are skipped before matching. These files document their own behaviour in
 * backtick-quoted prose, and a backtick is a string delimiter to a regex: the first draft reported
 * `bash scripts/audit.sh` out of a comment on `check.mjs:103` and would have refused every release
 * from then on. `stripComments` is deliberately NOT used — it stops blanking comments after the
 * first template literal with a substitution (see CLAUDE.md, "Blanking comments with a bare
 * `ts.createScanner` quietly stops working").
 */
const SPAWNED_SIBLING = /['"`](?:[\w./-]+\s+)*(?:\.\/)?scripts\/([\w.-]+\.(?:mjs|cjs|js|sh))/g;

/** The repository the wrapper is fetched from: `LT_CHECK_WRAPPER_SOURCE` (a mirror, a test fixture) or GitHub. */
export function checkWrapperSource(): string {
  return process.env.LT_CHECK_WRAPPER_SOURCE || DEFAULT_SOURCE;
}

/**
 * Check out the newest release of the check wrapper into a temporary directory.
 *
 * On success the caller owns the checkout and must call `release.dispose()`. On failure nothing
 * is left behind, and `error` says why in one line, ready to print.
 */
export function fetchCheckWrapperRelease(options: FetchCheckWrapperOptions = {}): CheckWrapperReleaseResult {
  const source = options.source ?? checkWrapperSource();
  const name = source === DEFAULT_SOURCE ? CHECK_WRAPPER_REPOSITORY : source;

  let tag: null | string;
  try {
    tag = latestReleaseTag(listTags(source));
  } catch (error) {
    return failure(`${name} is not reachable (${gitError(error)})`);
  }
  if (!tag) {
    return failure(`${name} has no release tag (vX.Y.Z)`);
  }

  const checkout = mkdtempSync(join(tmpdir(), 'lt-check-wrapper-'));
  const dispose = (): void => rmSync(checkout, { force: true, recursive: true });
  try {
    git(['clone', '--quiet', '--depth', '1', '--branch', tag, '--', source, checkout], CLONE_TIMEOUT_MS);
  } catch (error) {
    dispose();
    return failure(`${name} ${tag} could not be fetched (${gitError(error)})`);
  }

  const version = tag.slice(1);
  const problem = releaseProblem(checkout, tag, version);
  if (problem) {
    dispose();
    return failure(`${name} ${problem}`);
  }
  return { error: null, release: { assetPath: join(checkout, 'scripts', 'check.mjs'), dispose, tag, version } };
}

/** The highest `vX.Y.Z` tag, compared numerically; null when there is none. */
export function latestReleaseTag(tags: string[]): null | string {
  let latest: null | string = null;
  for (const tag of tags) {
    if (RELEASE_TAG.test(tag) && (!latest || compareVersions(tag.slice(1), latest.slice(1)) > 0)) {
      latest = tag;
    }
  }
  return latest;
}

/**
 * Sibling scripts the wrapper STARTS instead of importing, as `scripts/<name>`.
 * Deduplicated, and the wrapper's own name is never reported.
 *
 * @param scriptsDir Directory the names are resolved against (the release's `scripts/`).
 * @param files      Names relative to `scriptsDir`, e.g. `check.mjs`, `lib/ansi.mjs`.
 */
export function spawnedSiblings(scriptsDir: string, files: string[]): string[] {
  const found = new Set<string>();
  for (const name of files) {
    const file = join(scriptsDir, name);
    if (!existsSync(file)) {
      continue;
    }
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const code = line.trimStart();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) {
        continue;
      }
      for (const [, sibling] of code.matchAll(SPAWNED_SIBLING)) {
        if (sibling !== 'check.mjs' && sibling !== name) {
          found.add(sibling);
        }
      }
    }
  }
  return [...found].sort();
}

function failure(error: string): CheckWrapperReleaseResult {
  return { error, release: null };
}

/**
 * Run git without a terminal prompt and without the hook variables a linked worktree exports:
 * with `GIT_DIR` inherited, `git clone` would write into the repository the CLI was started from.
 */
function git(args: string[], timeout: number): string {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) {
    delete env[key];
  }
  return execFileSync('git', args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout });
}

/** One line on why a git call failed: its first stderr line, or "timed out". */
function gitError(error: unknown): string {
  const err = error as { code?: string; message?: string; signal?: string; stderr?: string };
  if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
    return 'timed out';
  }
  const line = `${err.stderr ?? ''}`
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  return line ?? `${err.message ?? 'git failed'}`.split('\n')[0];
}

/** Tag names of `source`. Throws when the remote cannot be read: an empty list is not proof of no tags. */
function listTags(source: string): string[] {
  const out = git(['ls-remote', '--tags', '--refs', '--', source], LS_REMOTE_TIMEOUT_MS);
  return out
    .split('\n')
    .map((line) => /\trefs\/tags\/(.+)$/.exec(line.trim())?.[1])
    .filter((tag): tag is string => Boolean(tag));
}

/** Why a checked-out release must not be installed, or null when it may. */
function releaseProblem(checkout: string, tag: string, version: string): null | string {
  const scriptsDir = join(checkout, 'scripts');
  const asset = join(scriptsDir, 'check.mjs');
  if (!existsSync(asset)) {
    return `${tag}: scripts/check.mjs not found`;
  }
  // Heal decides by this marker. One that disagrees with its tag would make that decision on a
  // version the content does not have.
  const marker = readWrapperVersion(asset);
  if (marker !== version) {
    return `${tag}: scripts/check.mjs carries the marker ${marker ?? '(none)'}, not ${version}`;
  }
  const shipped = resolveCopySet(asset).map(({ source }) => relative(scriptsDir, source).split(sep).join('/'));
  const spawned = spawnedSiblings(scriptsDir, shipped).filter((name) => !shipped.includes(name));
  if (spawned.length > 0) {
    return `${tag}: the wrapper starts ${spawned.join(', ')} without importing it, so the project would not get it`;
  }
  return null;
}
