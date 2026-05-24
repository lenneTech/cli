import type { GluegunFilesystem } from 'gluegun';

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
