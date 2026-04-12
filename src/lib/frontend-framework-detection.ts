/**
 * Framework-detection helpers for @lenne.tech/nuxt-extensions consumer projects.
 *
 * lenne.tech frontend projects can consume the framework in two modes:
 *
 *  - **npm mode** (classic): `@lenne.tech/nuxt-extensions` is installed as an npm
 *    dependency. Framework source lives in
 *    `node_modules/@lenne.tech/nuxt-extensions/`. The Nuxt config references
 *    the module via `modules: ['@lenne.tech/nuxt-extensions']`.
 *
 *  - **vendored mode**: The framework's source is copied directly
 *    into the project at `<app-root>/app/core/` as first-class project code.
 *    There is **no** `@lenne.tech/nuxt-extensions` dependency in `package.json`.
 *    The Nuxt config references `modules: ['./app/core/module']`.
 *
 * The detection is driven by the presence of `<app-root>/app/core/VENDOR.md`
 * (a baseline + patch-log file written by the vendoring pipeline).
 *
 * This module centralizes the detection logic so that every CLI command which
 * emits or patches nuxt-extensions-aware code can branch consistently.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export type FrontendFrameworkMode = 'npm' | 'vendor';

/**
 * Determines the current frontend framework consumption mode of the given project.
 *
 * Returns `'vendor'` if `VENDOR.md` indicates vendored mode. Otherwise
 * returns `'npm'` (the classic mode where `@lenne.tech/nuxt-extensions` is an
 * npm dependency).
 */
export function detectFrontendFrameworkMode(appDir: string): FrontendFrameworkMode {
  return isVendoredAppProject(appDir) ? 'vendor' : 'npm';
}

/**
 * Walks up from `startDir` looking for the nearest `nuxt.config.ts` (or
 * `nuxt.config.js`), returning the directory that contains it. Used by
 * commands invoked from a sub-directory of a frontend project.
 *
 * Returns `undefined` if no Nuxt config is found up to the filesystem root.
 */
export function findAppDir(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  while (current !== root) {
    if (
      existsSync(path.join(current, 'nuxt.config.ts')) ||
      existsSync(path.join(current, 'nuxt.config.js'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return undefined;
}

/**
 * Returns the filesystem root of the frontend framework source for the project.
 *
 * - npm mode:    `<appDir>/node_modules/@lenne.tech/nuxt-extensions`
 * - vendor mode: `<appDir>/app/core`
 *
 * Consumers that need to introspect framework source files should use this
 * instead of hard-coding either path.
 */
export function getFrontendFrameworkRootPath(appDir: string): string {
  return isVendoredAppProject(appDir)
    ? path.join(appDir, 'app', 'core')
    : path.join(appDir, 'node_modules', '@lenne.tech', 'nuxt-extensions');
}

/**
 * Detects whether the given frontend project directory runs in vendored mode.
 *
 * A project is considered vendored when:
 *   1. `<appDir>/app/core/VENDOR.md` exists, AND
 *   2. The VENDOR.md content references `@lenne.tech/nuxt-extensions` (guards
 *      against coincidental unrelated `VENDOR.md` files).
 *
 * @param appDir Absolute path to the frontend project (the directory that
 *               contains `nuxt.config.ts` and `app/`).
 */
export function isVendoredAppProject(appDir: string): boolean {
  const vendorMd = path.join(appDir, 'app', 'core', 'VENDOR.md');
  if (!existsSync(vendorMd)) {
    return false;
  }
  try {
    const content = readFileSync(vendorMd, 'utf-8');
    return content.includes('@lenne.tech/nuxt-extensions');
  } catch {
    return false;
  }
}
