import { execFileSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';

/** Marker value for the report-driven check wrapper. */
const WRAPPER = 'node scripts/check.mjs';

/** Where the wrapper and its imports live inside a project. */
const SCRIPTS_DIR = 'scripts';

interface Copy {
  /** Path relative to the project root, e.g. `scripts/check.mjs`. */
  rel: string;
  /** Absolute path of the bundled source file. */
  source: string;
}

interface CopyPlan extends Copy {
  action: 'skip' | 'up-to-date' | 'write';
  /** True when git holds no recoverable copy, so a `.bak` is written first. */
  backup: boolean;
}

/**
 * Idempotently install the report-driven check wrapper — and every module it
 * imports — into a project.
 *
 * Copies the bundled wrapper to `<root>/scripts/check.mjs`, copies its whole
 * relative-import closure alongside it under the names the wrapper imports them
 * by, and rewrites the root `package.json` so that `check` runs the wrapper
 * while the original chain is preserved as `check:raw`. A no-op once already
 * wired (so it is safe to run on every `lt fullstack update`).
 *
 * `lt fullstack init` already ships the wrapper via the template clone; this is
 * the MIGRATION path that brings it into pre-existing projects.
 *
 * The copy set moves ATOMICALLY: if any member must be skipped, none are
 * written. A partial update would leave `check.mjs` and a sibling on different
 * versions, and the project's `check` then dies on an import mismatch before
 * running a single step.
 *
 * @param projectRoot Absolute path to the (workspace) project root.
 * @param assetPath   Absolute path to the bundled wrapper. Its DIRECTORY is
 *                    also probed: every module the wrapper imports relatively
 *                    (transitively) is shipped from there. The asset always
 *                    lands as `scripts/check.mjs` regardless of its own name.
 * @returns The list of changed file paths (relative to `projectRoot`); empty when nothing changed.
 */
export function healCheckWrapper(projectRoot: string, assetPath: string): string[] {
  const changed: string[] = [];
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath) || !existsSync(assetPath)) {
    return changed;
  }

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return changed;
  }
  const scripts = pkg.scripts;
  // Only touch projects that actually define a `check` script.
  if (!scripts || typeof scripts.check !== 'string') {
    return changed;
  }

  // 1. Ensure the wrapper — and everything it imports — exists in the project
  // and matches the canonical version.
  //
  // The set is derived from the wrapper's own import statements rather than a
  // hard-coded name: the wrapper grew a sibling (`build-test-gate.mjs`, which
  // serialises the CPU-heavy build against the API e2e suite), and copying only
  // `check.mjs` installs a file whose very first import resolves to nothing —
  // the project's `check` then dies with ERR_MODULE_NOT_FOUND before running a
  // single step. Deriving it from the imports (not from "every .mjs in the
  // directory") keeps the next sibling free of changes here while making sure a
  // stray file in the asset dir never claims a path in the project's scripts/.
  const copies = resolveCopySet(assetPath);

  // Decide EVERY member before writing ANY of them — see the atomicity note in
  // the doc block above.
  const plans = copies.map((copy) => planCopy(projectRoot, copy));
  const blocked = plans.filter((p) => p.action === 'skip');
  if (blocked.length > 0) {
    // One entry for the whole set: the set is what could not be updated, and
    // naming only the blocking member would suggest the others did land.
    const names = blocked.map((p) => p.rel).join(', ');
    changed.push(
      `${copies.map((c) => c.rel).join(' + ')} (skipped: uncommitted changes in ${names} — commit or discard them, then re-run)`,
    );
  } else {
    for (const plan of plans) {
      if (plan.action === 'up-to-date') {
        continue;
      }
      writeCopy(projectRoot, plan);
      changed.push(plan.rel);
    }
  }

  // 2. Wire package.json: `check` runs the wrapper; the original chain becomes `check:raw`.
  if (scripts.check !== WRAPPER) {
    if (!scripts['check:raw']) {
      scripts['check:raw'] = scripts.check;
    }
    scripts.check = WRAPPER;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    changed.push('package.json');
  }

  return changed;
}

/**
 * The wrapper plus the transitive closure of its relative imports.
 *
 * Matches both quote styles: the bundled `.mjs` files are formatted by the
 * consuming project's formatter, not by this repo's, so their quote style is
 * not ours to assume.
 */
export function resolveCopySet(assetPath: string): Copy[] {
  const assetDir = dirname(assetPath);

  const copies: Copy[] = [{ rel: `${SCRIPTS_DIR}/check.mjs`, source: assetPath }];
  // Keyed by target rel, NOT by source basename: the asset lands as
  // `scripts/check.mjs` whatever it is called, so a `check.mjs` sitting beside a
  // differently-named asset must not claim that same path a second time.
  const claimed = new Set(copies.map((c) => c.rel));

  const queue = [assetPath];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);

    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // Resolved against the IMPORTING file, so `./lib/audit-report.mjs` in the
    // wrapper and `./ansi.mjs` inside `lib/` both land where Node looks for them.
    // Subdirectories count: copying only the wrapper's direct siblings installed
    // a `check.mjs` whose `./lib/*` imports resolved to nothing.
    for (const match of source.matchAll(/\bfrom\s+['"](\.\/[^'"]+)['"]/g)) {
      const resolved = resolve(dirname(file), match[1]);
      const inAsset = relative(assetDir, resolved);
      // Never out of the asset dir: an import that climbs out (`./../x.mjs`)
      // must not claim a path in the project's scripts/.
      if (!inAsset || inAsset === '..' || inAsset.startsWith(`..${sep}`) || isAbsolute(inAsset)) {
        continue;
      }
      const rel = `${SCRIPTS_DIR}/${inAsset.split(sep).join('/')}`;
      if (claimed.has(rel) || !isRegularFile(resolved)) {
        continue;
      }
      claimed.add(rel);
      copies.push({ rel, source: resolved });
      queue.push(resolved);
    }
  }
  return copies;
}

/**
 * True when the TRACKED `relPath` has uncommitted modifications. Overwriting
 * such a file would destroy work that exists nowhere else. Only meaningful for
 * a tracked path — see `isTracked`.
 */
function hasUncommittedChanges(projectRoot: string, relPath: string): boolean {
  try {
    const out = execFileSync('git', ['-C', projectRoot, 'status', '--porcelain', '--', relPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * True for a regular file, checked without following a symlink. A directory
 * named `*.mjs` would otherwise reach copyFileSync and abort the whole migration
 * with EISDIR.
 */
function isRegularFile(target: string): boolean {
  try {
    return lstatSync(target).isFile();
  } catch {
    return false;
  }
}

/** True when `target` is a symlink (checked without following it). */
function isSymlink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * True when git tracks `relPath`, i.e. it holds a recoverable copy.
 *
 * An empty `git status --porcelain` alone does NOT establish that: it is also
 * empty for an ignored file, and for a path in a directory git knows nothing
 * about. Those are precisely the cases where an overwrite is unrecoverable.
 */
function isTracked(projectRoot: string, relPath: string): boolean {
  try {
    execFileSync('git', ['-C', projectRoot, 'ls-files', '--error-unmatch', '--', relPath], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/** Decide what should happen to one copy target, without touching the disk. */
function planCopy(projectRoot: string, copy: Copy): CopyPlan {
  const target = join(projectRoot, copy.rel);
  const plan: CopyPlan = { ...copy, action: 'write', backup: false };

  if (!existsSync(target)) {
    return plan;
  }
  // A symlink here resolves OUTSIDE the project, and git reports the (unchanged)
  // link blob as clean, so the guard below cannot see it. Writing would silently
  // modify a file somewhere else entirely.
  if (isSymlink(target)) {
    plan.action = 'skip';
    return plan;
  }
  if (readFileSync(target, 'utf8') === readFileSync(copy.source, 'utf8')) {
    plan.action = 'up-to-date';
    return plan;
  }

  // A TRACKED file whose working copy diverges carries edits that exist nowhere
  // else — never overwrite it. A tracked-and-clean file is safe to replace
  // (git can restore it). Anything git does not track is not recoverable at
  // all, so it gets a `.bak` instead of a refusal: refusing would be the worse
  // outcome, because the wrapper's OWN previous output is untracked until the
  // user commits it, and a refusal there permanently blocks the update.
  if (isTracked(projectRoot, copy.rel)) {
    if (hasUncommittedChanges(projectRoot, copy.rel)) {
      plan.action = 'skip';
    }
    return plan;
  }
  plan.backup = true;
  return plan;
}

/** Write one planned copy, backing up an unversioned target first. */
function writeCopy(projectRoot: string, plan: CopyPlan): void {
  const target = join(projectRoot, plan.rel);
  mkdirSync(dirname(target), { recursive: true });

  if (plan.backup && existsSync(target)) {
    const backup = `${target}.bak`;
    // Keep the FIRST backup — a later run must not overwrite the original with
    // an already-generated copy.
    if (!existsSync(backup)) {
      copyFileSync(target, backup);
    }
  }

  // temp + rename so an interrupted run can never leave a half-written wrapper.
  const tmp = `${target}.lt-tmp-${process.pid}`;
  try {
    copyFileSync(plan.source, tmp);
    renameSync(tmp, target);
  } catch (error) {
    try {
      if (existsSync(tmp)) {
        unlinkSync(tmp);
      }
    } catch {
      /* best effort */
    }
    throw error;
  }
}
