/**
 * Which framework a frontend project is built with.
 *
 * The CLI scaffolds two frontends: Nuxt (nuxt-base-starter, framework library
 * `@lenne.tech/nuxt-extensions`) and Angular (ng-base-starter, framework library
 * `@lenne.tech/ng-base`). Every command that reads or changes an app after
 * scaffolding (`lt status`, `lt fullstack update`, both `convert-mode`s, `lt dev`)
 * has to know which one it is looking at, and decides it here, by the files the
 * project actually has.
 *
 * Decided by the framework's own config file first (`nuxt.config.*`,
 * `angular.json`), then by the framework package in `package.json`, so an app
 * whose config lives elsewhere is still recognised.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

import { isVendoredAppProject } from './frontend-framework-detection';
import { isVendoredNgBaseProject } from './ng-base-vendor';

export type FrontendKind = 'angular' | 'nuxt';

const NUXT_CONFIG_FILES = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'];

/**
 * The framework and the mode of its lt library (`@lenne.tech/nuxt-extensions` /
 * `@lenne.tech/ng-base`): `vendor` when the library is vendored, `npm` when it is a
 * dependency, `null` when the app uses neither (a plain Nuxt or Angular app).
 */
export function detectFrontendFramework(
  dir: string,
): undefined | { kind: FrontendKind; mode: 'npm' | 'vendor' | null } {
  const kind = detectFrontendKind(dir);
  if (!kind) {
    return undefined;
  }
  const vendored = kind === 'angular' ? isVendoredNgBaseProject(dir) : isVendoredAppProject(dir);
  if (vendored) {
    return { kind, mode: 'vendor' };
  }
  return { kind, mode: readDependencyNames(dir).has(frontendFrameworkPackage(kind)) ? 'npm' : null };
}

/**
 * Returns the framework of the frontend project in `dir`, or `undefined` when
 * `dir` is no frontend project the CLI knows.
 */
export function detectFrontendKind(dir: string): FrontendKind | undefined {
  if (NUXT_CONFIG_FILES.some((file) => existsSync(join(dir, file)))) {
    return 'nuxt';
  }
  if (existsSync(join(dir, 'angular.json'))) {
    return 'angular';
  }
  const deps = readDependencyNames(dir);
  if (deps.has('nuxt')) {
    return 'nuxt';
  }
  if (deps.has('@angular/core')) {
    return 'angular';
  }
  return undefined;
}

/**
 * Walks up from `startDir` to the nearest directory that is a Nuxt or Angular app
 * (`nuxt.config.*` / `angular.json`), for commands run from inside an app.
 */
export function findFrontendAppDir(startDir: string): string | undefined {
  let current = resolve(startDir);
  const root = parse(current).root;
  while (current !== root) {
    if (
      NUXT_CONFIG_FILES.some((file) => existsSync(join(current, file))) ||
      existsSync(join(current, 'angular.json'))
    ) {
      return current;
    }
    current = dirname(current);
  }
  return undefined;
}

/** How `lt status` names a frontend's framework mode. */
export function frontendFrameworkModeLabel(kind: FrontendKind, mode: 'npm' | 'vendor'): string {
  if (mode === 'vendor') {
    return kind === 'angular' ? 'vendor (src/core/, VENDOR.md)' : 'vendor (app/core/, VENDOR.md)';
  }
  return `npm (${frontendFrameworkPackage(kind)} dependency)`;
}

/** The framework library the CLI vendors for a frontend of this kind. */
export function frontendFrameworkPackage(kind: FrontendKind): string {
  return kind === 'angular' ? '@lenne.tech/ng-base' : '@lenne.tech/nuxt-extensions';
}

/** Human-readable framework name, as the CLI prints and writes it. */
export function frontendKindLabel(kind: FrontendKind): string {
  return kind === 'angular' ? 'Angular' : 'Nuxt 4';
}

function readDependencyNames(dir: string): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
    const names = new Set<string>();
    for (const section of ['dependencies', 'devDependencies']) {
      const deps = pkg[section];
      if (deps && typeof deps === 'object') {
        for (const name of Object.keys(deps)) {
          names.add(name);
        }
      }
    }
    return names;
  } catch {
    return new Set();
  }
}
