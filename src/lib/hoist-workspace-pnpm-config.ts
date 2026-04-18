import type { GluegunFilesystem } from 'gluegun';

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

  let rootChanged = false;

  for (const subDir of subProjects) {
    const subPkgPath = `${projectDir}/${subDir}/package.json`;
    if (!filesystem.exists(subPkgPath)) continue;
    const subPkg = filesystem.read(subPkgPath, 'json') as null | PackageJson;
    if (!subPkg?.pnpm) continue;

    let subChanged = false;
    for (const field of WORKSPACE_SCOPED_PNPM_FIELDS) {
      const subValue = subPkg.pnpm[field];
      if (subValue === undefined) continue;

      rootPkg.pnpm[field] = mergePnpmFieldValue(field, rootPkg.pnpm[field], subValue);
      rootChanged = true;

      delete subPkg.pnpm[field];
      subChanged = true;
    }

    if (subChanged) {
      // If the sub-project's pnpm section is now empty, drop it entirely.
      if (subPkg.pnpm && Object.keys(subPkg.pnpm).length === 0) {
        delete subPkg.pnpm;
      }
      filesystem.write(subPkgPath, `${JSON.stringify(subPkg, null, 2)}\n`);
    }
  }

  if (rootChanged) {
    filesystem.write(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
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
