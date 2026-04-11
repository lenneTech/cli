/**
 * Framework-detection helpers for @lenne.tech/nest-server consumer projects.
 *
 * lenne.tech API projects can consume the framework in two modes:
 *
 *  - **npm mode** (classic): `@lenne.tech/nest-server` is installed as an npm
 *    dependency. Framework source lives in
 *    `node_modules/@lenne.tech/nest-server/`. Generated code uses bare
 *    specifiers (`from '@lenne.tech/nest-server'`).
 *
 *  - **vendored mode**: The framework's `core/` directory is copied directly
 *    into the project at `<api-root>/src/core/` as first-class project code.
 *    There is **no** `@lenne.tech/nest-server` dependency in `package.json`.
 *    Generated code uses relative imports (`from '../../../core'`, depth
 *    varies by file location).
 *
 * The detection is driven by the presence of `<api-root>/src/core/VENDOR.md`
 * (a baseline + patch-log file written by the vendoring pilot).
 *
 * This module centralizes the detection logic so that every CLI command which
 * emits or patches nest-server-aware code can branch consistently.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export type FrameworkMode = 'npm' | 'vendor';

/**
 * Determines the current framework consumption mode of the given project.
 *
 * Returns `'vendor'` if `VENDOR.md` indicates vendored mode. Otherwise
 * returns `'npm'` (the classic mode where `@lenne.tech/nest-server` is an
 * npm dependency).
 */
export function detectFrameworkMode(projectDir: string): FrameworkMode {
  return isVendoredProject(projectDir) ? 'vendor' : 'npm';
}

/**
 * Walks up from `startDir` looking for the nearest `package.json`, returning
 * the directory that contains it. Used by commands that are invoked from a
 * sub-directory of an API project and need to find the project root.
 *
 * Returns `undefined` if no `package.json` is found up to the filesystem root.
 */
export function findProjectDir(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  while (current !== root) {
    if (existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return undefined;
}

/**
 * Returns the import specifier to use for `from '<framework>'` in generated
 * source code living at `sourceFilePath`.
 *
 * - npm mode:    always `'@lenne.tech/nest-server'` (bare specifier).
 * - vendor mode: a relative path from `sourceFilePath`'s directory to
 *                `<projectDir>/src/core`, normalized to forward slashes and
 *                prefixed with `./` if needed. Example: for
 *                `projectDir/src/server/modules/foo/foo.service.ts`, returns
 *                `'../../../core'`.
 *
 * `sourceFilePath` is the absolute path of the file that WILL CONTAIN the
 * import — NOT the file being imported. Depth is calculated from this path.
 *
 * @example
 * // Project at /abs/api, file at src/server/modules/foo/foo.service.ts
 * getFrameworkImportSpecifier('/abs/api',
 *   '/abs/api/src/server/modules/foo/foo.service.ts');
 * // → '../../../core'   (vendor mode)
 * // → '@lenne.tech/nest-server'  (npm mode)
 */
export function getFrameworkImportSpecifier(
  projectDir: string,
  sourceFilePath: string,
): string {
  if (!isVendoredProject(projectDir)) {
    return '@lenne.tech/nest-server';
  }
  const corePath = path.join(projectDir, 'src', 'core');
  const fromDir = path.dirname(sourceFilePath);
  let rel = path.relative(fromDir, corePath);
  // Normalize to POSIX separators (import specifiers are always forward-slash)
  rel = rel.split(path.sep).join('/');
  // Guarantee a relative prefix; sibling or descendant paths otherwise miss `./`
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  return rel;
}

/**
 * Returns the filesystem root of the framework source for the project.
 *
 * - npm mode:    `<projectDir>/node_modules/@lenne.tech/nest-server`
 * - vendor mode: `<projectDir>/src/core`
 *
 * Consumers that need to introspect framework source files (e.g. permissions
 * scanner, CrudService lookup) should use this instead of hard-coding either
 * path.
 */
export function getFrameworkRootPath(projectDir: string): string {
  return isVendoredProject(projectDir)
    ? path.join(projectDir, 'src', 'core')
    : path.join(projectDir, 'node_modules', '@lenne.tech', 'nest-server');
}

/**
 * Detects whether the given API project directory runs in vendored mode.
 *
 * A project is considered vendored when:
 *   1. `<projectDir>/src/core/VENDOR.md` exists, AND
 *   2. The VENDOR.md content references `@lenne.tech/nest-server` (guards
 *      against coincidental unrelated `VENDOR.md` files).
 *
 * @param projectDir Absolute path to the api project (the directory that
 *                   contains `package.json` and `src/`).
 */
export function isVendoredProject(projectDir: string): boolean {
  const vendorMd = path.join(projectDir, 'src', 'core', 'VENDOR.md');
  if (!existsSync(vendorMd)) {
    return false;
  }
  try {
    const content = readFileSync(vendorMd, 'utf-8');
    return content.includes('@lenne.tech/nest-server');
  } catch {
    return false;
  }
}
