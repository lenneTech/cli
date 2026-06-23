import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

/** Marker value for the report-driven check wrapper. */
const WRAPPER = 'node scripts/check.mjs';

/**
 * Idempotently install the report-driven `check.mjs` wrapper into a project.
 *
 * Copies the bundled canonical wrapper to `<root>/scripts/check.mjs` and rewrites
 * the root `package.json` so that `check` runs the wrapper while the original
 * chain is preserved as `check:raw`. A no-op once already wired (so it is safe to
 * run on every `lt fullstack update`).
 *
 * `lt fullstack init` already ships the wrapper via the template clone; this is
 * the MIGRATION path that brings it into pre-existing projects.
 *
 * @param projectRoot Absolute path to the (workspace) project root.
 * @param assetPath   Absolute path to the bundled canonical `check.mjs`.
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

  // 1. Ensure scripts/check.mjs exists and matches the bundled canonical version.
  const targetScript = join(projectRoot, 'scripts', 'check.mjs');
  const bundled = readFileSync(assetPath, 'utf8');
  if (!existsSync(targetScript) || readFileSync(targetScript, 'utf8') !== bundled) {
    mkdirSync(dirname(targetScript), { recursive: true });
    copyFileSync(assetPath, targetScript);
    changed.push('scripts/check.mjs');
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
