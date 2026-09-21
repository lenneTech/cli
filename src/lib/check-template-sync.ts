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

    // Refuse rather than ship silently: whether a spawned sibling belongs in the
    // template or whether lt-monorepo should drop the call is a human decision.
    const spawned = spawnedSiblings(templateDir, Object.keys(files)).filter((name) => !(name in files));
    if (spawned.length > 0) {
      throw new Error(
        `${ref}: the template starts sibling script(s) it does not ship: ${spawned.join(', ')}. ` +
          'resolveCopySet only follows imports, so these would be missing in every generated project. ' +
          'Add them to the wrapper\'s import closure, ship them deliberately, or remove the call upstream.',
      );
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
 * A sibling script the wrapper SPAWNS rather than imports.
 *
 * `resolveCopySet` follows imports, so a `node scripts/x.mjs` — or a spawn/execFile
 * with such a path — is invisible to it: the file is never shipped, the pin test stays
 * green, and only the generated project breaks. Matched on the path inside a STRING
 * rather than on the call shape, so `spawn('node', ['scripts/x.mjs'])`,
 * `execSync('bash scripts/x.sh')` and a bare `'scripts/x.mjs'` are all covered.
 *
 * Comment LINES are skipped before matching. These files document their own behaviour
 * in backtick-quoted prose, and a backtick is a string delimiter to a regex: the first
 * draft reported `bash scripts/audit.sh` out of a comment on `check.mjs:103` and would
 * have refused every sync from then on. `stripComments` is deliberately NOT used —
 * measured on this very file, it stops blanking at offset 3329, where a regex literal
 * (`/^projects\//`) is followed by a division (`ms / 1000`) and the standalone
 * TypeScript scanner, having no parser context, can no longer tell the two apart.
 */
const SPAWNED_SIBLING = /['"`](?:[\w./-]+\s+)*(?:\.\/)?scripts\/([\w.-]+\.(?:mjs|cjs|js|sh))/g;

/**
 * Sibling scripts the template STARTS instead of importing, as `scripts/<name>`.
 * Deduplicated, and the wrapper's own name is never reported.
 */
export function spawnedSiblings(templateDir: string, files: string[]): string[] {
  const found = new Set<string>();
  for (const name of files) {
    const file = join(templateDir, name);
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

/**
 * Differences between the template dir and its pin; empty when they match.
 * Checks three directions: every pinned file with its hash, every file the wrapper
 * imports is pinned (a hand-added import would otherwise slip by), and no file is
 * SPAWNED that nothing ships.
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
  for (const sibling of spawnedSiblings(templateDir, [...Object.keys(pin.files), ...actual])) {
    if (!(sibling in pin.files)) {
      problems.push(
        `${sibling}: STARTED by the template (\`node scripts/${sibling}\`) but not shipped — ` +
          'a generated project would call a file it does not have. Decide deliberately: add it to the ' +
          'template, or have lt-monorepo drop the call.',
      );
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
