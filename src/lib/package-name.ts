import type { GluegunFilesystem } from 'gluegun';

import { basename } from 'path';

import { slugify } from './dev-identity';

/**
 * package.json `name` values that are unchanged starter-template defaults.
 *
 * When a user clones a template manually (`git clone lenneTech/lt-monorepo
 * my-project`) instead of running `lt fullstack init`, the `name` field
 * stays at the template's default. That field is what
 * `dev-identity#projectSlug` reads to derive `<slug>.localhost`, so every
 * cloned project would collide on `https://lt-monorepo.localhost`.
 *
 * `lt fullstack init` rewrites this field already (see `setPackageName`);
 * the detection here is the safety net for projects that bypassed init.
 */
const UNMODIFIED_TEMPLATE_NAMES = new Set<string>(['lt-monorepo']);

/**
 * True when `name` matches a known unmodified starter template default.
 */
export function isUnmodifiedTemplateName(name: null | string | undefined): boolean {
  return typeof name === 'string' && UNMODIFIED_TEMPLATE_NAMES.has(name);
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
