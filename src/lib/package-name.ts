import type { GluegunFilesystem } from 'gluegun';

import { basename } from 'path';

import { isUnmodifiedTemplateName, slugify } from './dev-identity';

// `isUnmodifiedTemplateName` and the template-name detection now live in
// `dev-identity.ts` (the slug owner — `projectSlug` needs the same check to
// ignore an unmodified `lt-monorepo` name). Re-exported here so existing
// importers / tests of the package-name surface keep working unchanged.
export { isUnmodifiedTemplateName } from './dev-identity';

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
