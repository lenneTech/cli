/**
 * Keep `src/templates/check/` a verbatim copy of a PINNED lt-monorepo state.
 *
 * lt-monorepo is the upstream of the check wrapper. The copy here drifted two
 * releases behind once, and because heal treats the bundled copy as canonical,
 * `lt fullstack update` then downgraded freshly created projects. So the
 * template is never edited by hand: `npm run sync:check-template -- --ref <tag|sha>`
 * copies the wrapper plus its transitive imports from that ref and records the
 * commit and a hash per file in a pin file. A Jest test compares the template
 * against that pin without any network access.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { readWrapperVersion, resolveCopySet } from './heal-check-wrapper';

/** Pin of the bundled check template. */
export interface CheckTemplatePin {
  /** Full commit SHA the template was copied from. */
  commit: string;
  /** sha256 per file, keyed by its path inside the template dir (`check.mjs`, `lib/ansi.mjs`). */
  files: Record<string, string>;
  /** The ref that was requested (tag, branch or SHA); informational. */
  ref: string;
  /** Upstream repository. Never a local path, even when synced from a local clone. */
  repository: string;
  /** `@lt-check-wrapper` marker of the pinned `check.mjs`. */
  version: string;
}

export interface SyncCheckTemplateOptions {
  /** Git URL or local path to clone from. Default: the GitHub repository. */
  from?: string;
  /** Pin file. Default: `<templateDir>/lt-monorepo-pin.json`. */
  pinPath?: string;
  /** Tag, branch or commit to copy. */
  ref: string;
  /** Target template directory (holds `check.mjs`). */
  templateDir: string;
}

export const CHECK_TEMPLATE_REPOSITORY = 'lenneTech/lt-monorepo';
export const CHECK_TEMPLATE_PIN_FILE = 'lt-monorepo-pin.json';
const DEFAULT_FROM = `https://github.com/${CHECK_TEMPLATE_REPOSITORY}.git`;

/** Read a pin file; null when it is missing or unparseable. */
export function readCheckTemplatePin(pinPath: string): CheckTemplatePin | null {
  try {
    return JSON.parse(readFileSync(pinPath, 'utf8')) as CheckTemplatePin;
  } catch {
    return null;
  }
}

/**
 * Copy `scripts/check.mjs` and its transitive relative imports from `ref` into
 * the template dir and write the pin. Files the previous pin listed but the new
 * closure no longer contains are removed; nothing else in the dir is touched.
 *
 * Refuses a source without an `@lt-check-wrapper` marker: an unversioned
 * template would switch the downgrade guard in heal off without a trace.
 */
export function syncCheckTemplate(options: SyncCheckTemplateOptions): CheckTemplatePin {
  const { from = DEFAULT_FROM, ref, templateDir } = options;
  const pinPath = options.pinPath ?? join(templateDir, CHECK_TEMPLATE_PIN_FILE);
  const checkout = mkdtempSync(join(tmpdir(), 'lt-check-template-'));
  try {
    const git = (...args: string[]): string =>
      execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('clone', '--quiet', '--no-checkout', from, checkout);
    git('-C', checkout, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', ref);
    const commit = git('-C', checkout, 'rev-parse', 'HEAD');

    const asset = join(checkout, 'scripts', 'check.mjs');
    if (!existsSync(asset)) {
      throw new Error(`${ref}: scripts/check.mjs not found`);
    }
    const version = readWrapperVersion(asset);
    if (!version) {
      throw new Error(`${ref}: scripts/check.mjs carries no @lt-check-wrapper marker — refusing to pin it`);
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`${ref}: @lt-check-wrapper marker "${version}" is not a version — refusing to pin it`);
    }

    const previous = readCheckTemplatePin(pinPath);
    const files: Record<string, string> = {};
    for (const { rel, source } of resolveCopySet(asset)) {
      const name = rel.replace(/^scripts\//, '');
      const target = join(templateDir, name);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      files[name] = hashFile(target);
    }
    for (const stale of Object.keys(previous?.files ?? {})) {
      // Names come from the pin file; never let one reach outside the template dir.
      if (!(stale in files) && !stale.split(/[\\/]/).includes('..')) {
        rmSync(join(templateDir, stale), { force: true });
      }
    }

    const pin: CheckTemplatePin = {
      commit,
      files: sortKeys(files),
      ref,
      repository: CHECK_TEMPLATE_REPOSITORY,
      version,
    };
    writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
    return pin;
  } finally {
    rmSync(checkout, { force: true, recursive: true });
  }
}

/**
 * Differences between the template dir and its pin; empty when they match.
 * Checks both directions: every pinned file with its hash, and every file the
 * wrapper actually imports is pinned (a hand-added import would otherwise slip by).
 */
export function verifyCheckTemplate(templateDir: string, pin: CheckTemplatePin): string[] {
  const problems: string[] = [];
  const actual = new Set(resolveCopySet(join(templateDir, 'check.mjs')).map((c) => c.rel.replace(/^scripts\//, '')));

  for (const [name, hash] of Object.entries(pin.files)) {
    const file = join(templateDir, name);
    if (!existsSync(file)) {
      problems.push(`${name}: pinned but missing`);
    } else if (hashFile(file) !== hash) {
      problems.push(`${name}: differs from ${CHECK_TEMPLATE_REPOSITORY}@${pin.commit.slice(0, 7)}`);
    }
  }
  for (const name of actual) {
    if (!(name in pin.files)) {
      problems.push(`${name}: imported by the wrapper but not pinned`);
    }
  }
  const version = readWrapperVersion(join(templateDir, 'check.mjs'));
  if (version !== pin.version) {
    problems.push(`check.mjs: marker ${version ?? '(none)'} does not match pinned version ${pin.version}`);
  }
  return problems;
}

function hashFile(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
