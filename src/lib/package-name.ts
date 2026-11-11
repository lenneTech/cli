import type { GluegunFilesystem } from 'gluegun';

import { basename } from 'path';

import { isUnmodifiedTemplateName, slugify } from './dev-identity';

// `isUnmodifiedTemplateName` and the template-name detection now live in
// `dev-identity.ts` (the slug owner — `projectSlug` needs the same check to
// ignore an unmodified `lt-monorepo` name). Re-exported here so existing
// importers / tests of the package-name surface keep working unchanged.
export { isUnmodifiedTemplateName } from './dev-identity';

/**
 * Gives a package.json taken over from a starter the identity of the new project.
 *
 * ng-base-starter is flat (repo root = app), so a scaffold inherits its package.json
 * as it is: `name` `ng-base-starter`, the starter's release `version`, its
 * `description` and its `repository` link. Every reader of the file then describes the
 * starter, and `lt dev` derives its slug from `name`, so two standalone apps shared one
 * URL. This sets `name` and `version` and drops the fields that say where the code came
 * from. Everything else (scripts, dependencies, engines, `license`) stays.
 */
export function applyScaffoldIdentity(
  pkg: Record<string, unknown>,
  identity: { name: string; version: string },
): Record<string, unknown> {
  pkg.name = identity.name;
  pkg.version = identity.version;
  for (const field of ['bugs', 'description', 'homepage', 'repository']) {
    delete pkg[field];
  }
  return pkg;
}

/**
 * If the package.json at `<projectRoot>/package.json` still carries an
 * unmodified starter-template `name` (e.g. `lt-monorepo` from a raw
 * `git clone`), rewrite it to the directory basename — which is what the
 * user actually called their project when they cloned the folder.
 *
 * Returns the new name if a rewrite happened, `null` otherwise. Reasons
 * for `null`: missing/unreadable package.json, name already custom, or the
 * directory basename itself is in the deny list (pathological case of a
 * fresh clone into a literal `lt-monorepo` folder — leaving the file
 * untouched is correct behaviour there).
 *
 * Idempotent — safe to call from every `lt dev init` invocation.
 */
export function renameUnmodifiedTemplatePackage(options: {
  filesystem: GluegunFilesystem;
  projectRoot: string;
}): null | string {
  const { filesystem, projectRoot } = options;
  const packageJsonPath = filesystem.path(projectRoot, 'package.json');
  if (!filesystem.exists(packageJsonPath)) return null;

  const pkg = filesystem.read(packageJsonPath, 'json') as null | Record<string, unknown>;
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return null;

  const currentName = typeof pkg.name === 'string' ? pkg.name : null;
  if (!isUnmodifiedTemplateName(currentName)) return null;

  // Slugify the directory basename: npm names must be lowercase and
  // URL-safe, and this keeps the rewritten value consistent with what
  // `lt fullstack init` writes (which kebab-cases its --name arg) and
  // with `dev-identity#projectSlug` (which slugifies whatever it reads
  // back). Anything else would produce a slug mismatch between
  // package.json and `<slug>.localhost`.
  const derived = slugify(basename(projectRoot));
  if (!derived || isUnmodifiedTemplateName(derived)) return null;

  const written = setPackageName({ filesystem, name: derived, packageJsonPath });
  return written ? derived : null;
}

/**
 * Set the `name` field of a package.json on disk.
 *
 * Used by `lt fullstack init` to rename the cloned monorepo's root package
 * so each project gets a unique `lt dev` slug (the slug is derived from
 * package.json `name`; without a rename every lt-monorepo-based project would
 * register as `lt-monorepo` and collide on `https://lt-monorepo.localhost`).
 *
 * IMPORTANT: this reads/writes the file as parsed JSON rather than running a
 * string regex through `patching.update`. Gluegun's `patching.update` hands
 * the callback a *parsed object* for any `.json` file, so a String-based
 * `content.replace(...)` callback throws `content.replace is not a function`
 * at runtime. Going through parsed JSON here is both correct and robust: it
 * adds a `name` field if one is missing instead of silently no-op'ing.
 *
 * Idempotent: if the name already equals `name`, the file is left untouched
 * and the function returns false.
 *
 * @param options.filesystem      Gluegun filesystem tool
 * @param options.name            New value for the `name` field
 * @param options.packageJsonPath Absolute path to the package.json
 * @returns true if the file was written, false otherwise (missing/unreadable/unchanged)
 */
export function setPackageName(options: {
  filesystem: GluegunFilesystem;
  name: string;
  packageJsonPath: string;
}): boolean {
  const { filesystem, name, packageJsonPath } = options;
  if (!filesystem.exists(packageJsonPath)) return false;

  const pkg = filesystem.read(packageJsonPath, 'json') as null | Record<string, unknown>;
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return false;

  if (pkg.name === name) return false;
  pkg.name = name;
  filesystem.write(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
}

/**
 * Set the `version` field of a package.json on disk.
 *
 * Used by `lt fullstack init` next to `setPackageName`: the cloned lt-monorepo
 * root carries the TEMPLATE's release version (e.g. `3.17.2`), which a new
 * project would otherwise start with and `lt status` would report as the
 * project's version. It is easily mistaken for the `@lt-check-wrapper` marker
 * in `scripts/check.mjs`, which names the same release but is a different thing:
 * the marker stays tied to the check wrapper, the version belongs to the project.
 *
 * Same JSON handling and idempotency as `setPackageName`.
 *
 * @returns true if the file was written, false otherwise (missing/unreadable/unchanged)
 */
export function setPackageVersion(options: {
  filesystem: GluegunFilesystem;
  packageJsonPath: string;
  version: string;
}): boolean {
  const { filesystem, packageJsonPath, version } = options;
  if (!filesystem.exists(packageJsonPath)) return false;

  const pkg = filesystem.read(packageJsonPath, 'json') as null | Record<string, unknown>;
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return false;

  if (pkg.version === version) return false;
  pkg.version = version;
  filesystem.write(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
}
