import type { GluegunFilesystem } from 'gluegun';

import { dump, load } from 'js-yaml';

import { isSymlink } from './fs-utils';

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
 *
 * Object-valued fields (`overrides`, `allowBuilds`) merge key-by-key;
 * array-valued fields union + dedupe + sort. `minimumReleaseAgeExclude`
 * is hoisted too so a sub-project's first-party exemption (e.g.
 * `@lenne.tech/*`) keeps working in the monorepo — otherwise the
 * minimum-release-age gate would block freshly published own packages.
 */
const OBJECT_FIELDS = ['overrides', 'allowBuilds'] as const;
const ARRAY_FIELDS = ['onlyBuiltDependencies', 'ignoredOptionalDependencies', 'minimumReleaseAgeExclude'] as const;
const WORKSPACE_SCOPED_PNPM_FIELDS = [...OBJECT_FIELDS, ...ARRAY_FIELDS] as const;

type PnpmConfigField = (typeof WORKSPACE_SCOPED_PNPM_FIELDS)[number];

const isArrayField = (field: PnpmConfigField): boolean => (ARRAY_FIELDS as readonly string[]).includes(field);

interface PackageJson {
  [k: string]: unknown;
  pnpm?: Record<string, unknown>;
}

/**
 * Hoist workspace-scoped pnpm config from sub-projects into the monorepo
 * root `pnpm-workspace.yaml`. After this runs, sub-project pnpm config
 * (package.json#pnpm or a settings-only pnpm-workspace.yaml) is gone, and
 * the root pnpm-workspace.yaml carries the merged union next to `packages:`.
 *
 * Why pnpm-workspace.yaml and not package.json#pnpm: the monorepo root
 * pins pnpm 11 (via `packageManager`), and pnpm 11 SILENTLY IGNORES the
 * `pnpm` block in package.json — overrides/build-allowlists/etc. declared
 * there never take effect, regressing `pnpm audit` and the minimum-release
 * -age exemptions. pnpm-workspace.yaml is the pnpm-recommended home and is
 * read by both pnpm 10 and 11.
 *
 * Two sources are read per sub-project, because the two starters store
 * their pnpm config differently:
 *
 *   1. `<sub>/package.json` `pnpm` block — nest-server-starter, and any
 *      template that has not migrated to the pnpm-11 layout yet.
 *   2. `<sub>/pnpm-workspace.yaml` — nuxt-base-template (pnpm-11 layout).
 *      Inside a monorepo that nested file would (a) not be hoisted if we
 *      only read package.json, regressing the CVE overrides, and (b)
 *      declare a nested workspace root that conflicts with the monorepo's
 *      own pnpm-workspace.yaml. We hoist its fields into the root and
 *      remove the now-redundant nested file.
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
  const rootWsPath = `${projectDir}/pnpm-workspace.yaml`;

  // The root pnpm-workspace.yaml is the destination. It normally exists (the
  // lt-monorepo clone ships one declaring `packages:`); start from it so
  // `packages:` and any root-owned settings are preserved.
  const rootWs = readYaml(filesystem, rootWsPath) ?? {};

  let rootChanged = false;

  for (const subDir of subProjects) {
    const subPath = `${projectDir}/${subDir}`;
    if (!filesystem.exists(subPath)) continue;
    // Never mutate a symlinked sub-project — it points at the user's own
    // checkout in link mode.
    if (isSymlink(subPath)) continue;

    if (hoistFromSubPackageJson({ filesystem, rootWs, subPath })) {
      rootChanged = true;
    }
    if (hoistFromSubWorkspaceYaml({ filesystem, rootWs, subPath })) {
      rootChanged = true;
    }
  }

  if (rootChanged) {
    // Keep allowBuilds (pnpm 11) and onlyBuiltDependencies (pnpm 10) in sync so
    // the build-script allowlist survives regardless of which key pnpm reads.
    syncBuildAllowlists(rootWs);
    filesystem.write(rootWsPath, dump(rootWs, { lineWidth: -1, sortKeys: false }));
  }
}

/**
 * Move the workspace-scoped pnpm fields from `source` into `rootWs`,
 * deleting each moved field from `source`. Returns true if anything moved.
 */
function hoistFields(rootWs: Record<string, unknown>, source: Record<string, unknown>): boolean {
  let changed = false;
  for (const field of WORKSPACE_SCOPED_PNPM_FIELDS) {
    if (source[field] === undefined) continue;
    rootWs[field] = mergePnpmFieldValue(field, rootWs[field], source[field]);
    delete source[field];
    changed = true;
  }
  return changed;
}

/** Source 1: the sub-project's package.json `pnpm` block. */
function hoistFromSubPackageJson(options: {
  filesystem: GluegunFilesystem;
  rootWs: Record<string, unknown>;
  subPath: string;
}): boolean {
  const { filesystem, rootWs, subPath } = options;
  const subPkgPath = `${subPath}/package.json`;
  if (!filesystem.exists(subPkgPath)) return false;
  const subPkg = filesystem.read(subPkgPath, 'json') as null | PackageJson;
  if (!subPkg?.pnpm) return false;

  if (!hoistFields(rootWs, subPkg.pnpm)) return false;

  // If the sub-project's pnpm section is now empty, drop it entirely.
  if (Object.keys(subPkg.pnpm).length === 0) {
    delete subPkg.pnpm;
  }
  filesystem.write(subPkgPath, `${JSON.stringify(subPkg, null, 2)}\n`);
  return true;
}

/** Source 2: the sub-project's pnpm-workspace.yaml. */
function hoistFromSubWorkspaceYaml(options: {
  filesystem: GluegunFilesystem;
  rootWs: Record<string, unknown>;
  subPath: string;
}): boolean {
  const { filesystem, rootWs, subPath } = options;
  const subWsPath = `${subPath}/pnpm-workspace.yaml`;
  if (!filesystem.exists(subWsPath)) return false;

  const ws = readYaml(filesystem, subWsPath);
  if (!ws) return false;

  if (!hoistFields(rootWs, ws)) return false;

  // A settings-only file (no `packages:`) exists solely to carry these
  // hoisted keys — once emptied it would only declare a nested workspace
  // root, so remove it. A file that declares `packages:` is a real (rare)
  // nested workspace; keep it minus the hoisted keys.
  if (Array.isArray(ws.packages) && ws.packages.length > 0) {
    filesystem.write(subWsPath, dump(ws, { lineWidth: -1, sortKeys: false }));
  } else {
    filesystem.remove(subWsPath);
  }
  return true;
}

/**
 * Merge two values for a pnpm workspace-scoped field.
 *
 * Arrays (`onlyBuiltDependencies`, `ignoredOptionalDependencies`,
 * `minimumReleaseAgeExclude`): deduplicated, alphabetically sorted union.
 *
 * Objects (`overrides`, `allowBuilds`): key-by-key merge where sub-project
 * values take precedence over root (sub-projects like nest-server-starter
 * own the authoritative CVE override list for their transitive deps; the
 * root usually only seeds cross-cutting patches).
 */
function mergePnpmFieldValue(field: PnpmConfigField, rootValue: unknown, subValue: unknown): unknown {
  if (isArrayField(field)) {
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

/** Parse a YAML file into a plain object, or null on missing/malformed/non-object. */
function readYaml(filesystem: GluegunFilesystem, path: string): null | Record<string, unknown> {
  if (!filesystem.exists(path)) return null;
  const raw = filesystem.read(path);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = load(raw);
  } catch {
    // Malformed YAML — leave it untouched rather than risk data loss.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Keep the two build-allowlist forms consistent and complete after hoisting:
 * - `allowBuilds` (pnpm 11) is a `{ pkg: boolean }` map.
 * - `onlyBuiltDependencies` (pnpm 10) is a `string[]` of allowed packages.
 *
 * Sub-templates carry one or both (nest-server-starter only `allowBuilds`,
 * nuxt-base-template both). After merging we derive the full set of allowed
 * packages from BOTH forms and write back canonical, sorted twins so the
 * allowlist survives whichever key the active pnpm version reads. Explicit
 * `false` entries in `allowBuilds` are preserved (and excluded from the
 * array). No-op when neither key is present. Mutates `ws` in place.
 */
function syncBuildAllowlists(ws: Record<string, unknown>): void {
  const arr = Array.isArray(ws.onlyBuiltDependencies) ? (ws.onlyBuiltDependencies as string[]) : [];
  const obj =
    ws.allowBuilds && typeof ws.allowBuilds === 'object' && !Array.isArray(ws.allowBuilds)
      ? (ws.allowBuilds as Record<string, unknown>)
      : {};
  if (arr.length === 0 && Object.keys(obj).length === 0) return;

  // Every array entry implies allowBuilds[entry] = true unless already set.
  const map: Record<string, boolean> = {};
  for (const [pkg, enabled] of Object.entries(obj)) map[pkg] = enabled === true;
  for (const pkg of arr) if (map[pkg] === undefined) map[pkg] = true;

  const allowed = Object.entries(map)
    .filter(([, enabled]) => enabled)
    .map(([pkg]) => pkg)
    .sort((a, b) => a.localeCompare(b));

  ws.allowBuilds = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  ws.onlyBuiltDependencies = allowed;
}
