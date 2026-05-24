import type { GluegunFilesystem } from 'gluegun';

import { lstatSync } from 'fs';
import { dump, load } from 'js-yaml';

/**
 * pnpm workspace-scoped fields that must live at the workspace root.
 * When present in sub-project package.json files, pnpm emits:
 *
 *   WARN  The field "<field>" was found in <path>. This will not take
 *   effect. You should configure "<field>" at the root of the workspace
 *   instead.
 *
 * Crucially, the WARN also means the values are silently ignored — CVE
 * overrides defined only in projects/api/package.json never reach the
 * install resolver. Hoisting them to the root fixes both the warning
 * and the actual dependency-resolution behavior.
 */
const WORKSPACE_SCOPED_PNPM_FIELDS = ['overrides', 'onlyBuiltDependencies', 'ignoredOptionalDependencies'] as const;

/**
 * pnpm 11 renamed `onlyBuiltDependencies` (string array) to `allowBuilds`
 * (a `{ pkg: boolean }` map). A migrated sub-project pnpm-workspace.yaml
 * usually carries BOTH for cross-version compatibility, but we must not
 * rely on the array twin always being present: we normalise `allowBuilds`
 * back into `onlyBuiltDependencies` before hoisting (see
 * `normalizeAllowBuilds`) so the build-allowlist survives into the pnpm-10
 * monorepo root even when the file only carries the pnpm-11 object form.
 */
const PNPM11_BUILD_KEY = 'allowBuilds';

interface PackageJson {
  [k: string]: unknown;
  pnpm?: Partial<Record<PnpmConfigField, unknown>> & Record<string, unknown>;
}

type PnpmConfigField = (typeof WORKSPACE_SCOPED_PNPM_FIELDS)[number];

/**
 * Hoist workspace-scoped pnpm config from sub-projects into the root
 * package.json. After this runs, sub-project package.json files no
 * longer have `overrides`, `onlyBuiltDependencies`, or
 * `ignoredOptionalDependencies`, and the root package.json contains
 * the merged union.
 *
 * Two sources are read per sub-project, because the two starters store
 * their pnpm config differently:
 *
 *   1. `<sub>/package.json` `pnpm` block — nest-server-starter, and
 *      nuxt-base-template before its pnpm-11 migration.
 *   2. `<sub>/pnpm-workspace.yaml` — nuxt-base-template after the
 *      migration. pnpm 11 silently ignores the `pnpm` block in
 *      package.json, so the template moved overrides into
 *      pnpm-workspace.yaml. Inside a monorepo that nested file would
 *      (a) not be hoisted by the old package.json-only logic, regressing
 *      the CVE overrides, and (b) declare a nested workspace root that
 *      conflicts with the monorepo's own pnpm-workspace.yaml. We hoist
 *      its fields into the root package.json (the lt-monorepo root pins
 *      pnpm@10 via `packageManager`, where package.json#pnpm IS honored)
 *      and remove the now-redundant nested file.
 *
 * Symlinked sub-projects are skipped entirely: in `--frontend-link` /
 * `--api-link` mode `projects/app` (or `projects/api`) points at the
 * user's local framework checkout, and stripping its config or deleting
 * its pnpm-workspace.yaml would corrupt that source repo.
 *
 * Idempotent: running twice has the same effect as running once.
 *
 * @param options.filesystem  Gluegun filesystem tool
 * @param options.projectDir  Workspace root (contains pnpm-workspace.yaml)
 * @param options.subProjects Sub-project dirs relative to projectDir
 */
export function hoistWorkspacePnpmConfig(options: {
  filesystem: GluegunFilesystem;
  projectDir: string;
  subProjects: string[];
}): void {
  const { filesystem, projectDir, subProjects } = options;
  const rootPkgPath = `${projectDir}/package.json`;
  if (!filesystem.exists(rootPkgPath)) return;

  const rootPkg = filesystem.read(rootPkgPath, 'json') as null | PackageJson;
  if (!rootPkg) return;
  rootPkg.pnpm ??= {};
  const rootPnpm = rootPkg.pnpm;

  let rootChanged = false;

  for (const subDir of subProjects) {
    const subPath = `${projectDir}/${subDir}`;
    if (!filesystem.exists(subPath)) continue;
    // Never mutate a symlinked sub-project — it points at the user's own
    // checkout in link mode.
    if (isSymlink(subPath)) continue;

    if (hoistFromSubPackageJson({ filesystem, rootPnpm, subPath })) {
      rootChanged = true;
    }
    if (hoistFromSubWorkspaceYaml({ filesystem, rootPnpm, subPath })) {
      rootChanged = true;
    }
  }

  if (rootChanged) {
    filesystem.write(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
  }
}

/**
 * Move the workspace-scoped pnpm fields from `source` into `rootPnpm`,
 * deleting each moved field from `source`. Returns true if anything moved.
 */
function hoistFields(rootPnpm: Record<string, unknown>, source: Record<string, unknown>): boolean {
  let changed = false;
  for (const field of WORKSPACE_SCOPED_PNPM_FIELDS) {
    if (source[field] === undefined) continue;
    rootPnpm[field] = mergePnpmFieldValue(field, rootPnpm[field], source[field]);
    delete source[field];
    changed = true;
  }
  return changed;
}

/** Source 1: the sub-project's package.json `pnpm` block. */
function hoistFromSubPackageJson(options: {
  filesystem: GluegunFilesystem;
  rootPnpm: Record<string, unknown>;
  subPath: string;
}): boolean {
  const { filesystem, rootPnpm, subPath } = options;
  const subPkgPath = `${subPath}/package.json`;
  if (!filesystem.exists(subPkgPath)) return false;
  const subPkg = filesystem.read(subPkgPath, 'json') as null | PackageJson;
  if (!subPkg?.pnpm) return false;

  if (!hoistFields(rootPnpm, subPkg.pnpm)) return false;

  // If the sub-project's pnpm section is now empty, drop it entirely.
  if (Object.keys(subPkg.pnpm).length === 0) {
    delete subPkg.pnpm;
  }
  filesystem.write(subPkgPath, `${JSON.stringify(subPkg, null, 2)}\n`);
  return true;
}

/** Source 2: the sub-project's pnpm-workspace.yaml (pnpm-11 layout). */
function hoistFromSubWorkspaceYaml(options: {
  filesystem: GluegunFilesystem;
  rootPnpm: Record<string, unknown>;
  subPath: string;
}): boolean {
  const { filesystem, rootPnpm, subPath } = options;
  const subWsPath = `${subPath}/pnpm-workspace.yaml`;
  if (!filesystem.exists(subWsPath)) return false;

  const raw = filesystem.read(subWsPath);
  if (!raw) return false;

  let parsed: unknown;
  try {
    parsed = load(raw);
  } catch {
    // Malformed YAML — leave it untouched rather than risk data loss.
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const ws = parsed as Record<string, unknown>;

  // Fold the pnpm-11 `allowBuilds` map into `onlyBuiltDependencies` so it is
  // hoisted rather than discarded — even when the array twin is absent.
  normalizeAllowBuilds(ws);

  if (!hoistFields(rootPnpm, ws)) return false;

  // A settings-only file (no `packages:`) exists solely to carry these
  // hoisted keys — once emptied it would only declare a nested workspace
  // root, so remove it. A file that declares `packages:` is a real (rare)
  // nested workspace; keep it minus the hoisted keys.
  if (Array.isArray(ws.packages) && ws.packages.length > 0) {
    filesystem.write(subWsPath, dump(ws));
  } else {
    filesystem.remove(subWsPath);
  }
  return true;
}

/** Whether `path` is a symbolic link (false on any stat error). */
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Merge two values for a pnpm workspace-scoped field.
 *
 * pnpm expects:
 * - `overrides` → object ({pkg: version})
 * - `onlyBuiltDependencies` → array of strings
 * - `ignoredOptionalDependencies` → array of strings
 *
 * Arrays: deduplicated, alphabetically sorted union.
 * Objects: sub-project values take precedence over root (sub-projects
 * like nest-server-starter own the authoritative CVE override list for
 * their transitive deps; the root usually only seeds cross-cutting
 * handlebars/minimatch patches).
 */
function mergePnpmFieldValue(field: PnpmConfigField, rootValue: unknown, subValue: unknown): unknown {
  if (field === 'onlyBuiltDependencies' || field === 'ignoredOptionalDependencies') {
    const rootArr = Array.isArray(rootValue) ? (rootValue as string[]) : [];
    const subArr = Array.isArray(subValue) ? (subValue as string[]) : [];
    return Array.from(new Set([...rootArr, ...subArr])).sort((a, b) => a.localeCompare(b));
  }
  const rootObj =
    rootValue && typeof rootValue === 'object' && !Array.isArray(rootValue)
      ? (rootValue as Record<string, unknown>)
      : {};
  const subObj =
    subValue && typeof subValue === 'object' && !Array.isArray(subValue) ? (subValue as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = { ...rootObj, ...subObj };
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Fold a pnpm-11 `allowBuilds: { pkg: boolean }` map into the pnpm-10
 * `onlyBuiltDependencies: string[]` form (packages whose value is `true`),
 * unioned with any existing array, then remove the `allowBuilds` key so the
 * redundant object form does not linger. Mutates `ws` in place.
 *
 * No-op when `allowBuilds` is absent or not an object map — an unexpected
 * shape is left untouched rather than risk silent data loss.
 */
function normalizeAllowBuilds(ws: Record<string, unknown>): void {
  const raw = ws[PNPM11_BUILD_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;

  const allowed = Object.entries(raw as Record<string, unknown>)
    .filter(([, enabled]) => enabled === true)
    .map(([pkg]) => pkg);
  if (allowed.length > 0) {
    const existing = Array.isArray(ws.onlyBuiltDependencies) ? (ws.onlyBuiltDependencies as string[]) : [];
    // Order here is irrelevant — mergePnpmFieldValue sorts the union on hoist.
    ws.onlyBuiltDependencies = Array.from(new Set([...allowed, ...existing]));
  }
  delete ws[PNPM11_BUILD_KEY];
}
