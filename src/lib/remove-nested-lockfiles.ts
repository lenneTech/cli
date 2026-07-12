import type { GluegunFilesystem } from 'gluegun';

import { isSymlink } from './fs-utils';

// In a pnpm workspace only the ROOT pnpm-lock.yaml is read, resolved and
// updated. A `pnpm-lock.yaml` that a starter brought along from its standalone
// life keeps sitting in projects/api or projects/app, never gets refreshed, and
// silently drifts away from the root lockfile — in one project it was a month
// old and 11k lines shorter.
//
// Dead weight would be harmless; the file is worse than that, because anything
// that builds with the sub-project as its context (an old `Dockerfile.dev`, an
// ad-hoc `pnpm install --frozen-lockfile` inside projects/app) installs that
// stale tree instead of the workspace's. Removing it makes the workspace root
// the single source of truth.
//
// Only pnpm lockfiles are removed. `yarn.lock` / `package-lock.json` mark a
// sub-project that deliberately uses another package manager, and `lt dev`
// reads them to pick the right binary per project dir. A pnpm sub-project loses
// nothing: `pickPackageManager()` falls back to pnpm when no lockfile is found.
const PNPM_LOCKFILE = 'pnpm-lock.yaml';

/**
 * Delete sub-project `pnpm-lock.yaml` files that the workspace root supersedes.
 *
 * No-op unless `projectDir` really is a pnpm workspace root (it must carry a
 * `pnpm-workspace.yaml`) — outside one a nested lockfile may be the only one.
 * Symlinked sub-projects are skipped: in `--api-link` / `--frontend-link` mode
 * they point at the user's own checkout, which must not be mutated.
 *
 * @param options.filesystem   gluegun filesystem toolbox member
 * @param options.projectDir   workspace root
 * @param options.subProjects  paths relative to the root, e.g. `projects/api`
 * @returns the sub-project dirs whose lockfile was removed
 */
export function removeNestedLockfiles(options: {
  filesystem: GluegunFilesystem;
  projectDir: string;
  subProjects: string[];
}): { removed: string[] } {
  const { filesystem, projectDir, subProjects } = options;

  if (!filesystem.exists(`${projectDir}/pnpm-workspace.yaml`)) return { removed: [] };

  const removed: string[] = [];
  for (const subDir of subProjects) {
    const subPath = `${projectDir}/${subDir}`;
    if (!filesystem.exists(subPath)) continue;
    if (isSymlink(subPath)) continue;

    const lockfile = `${subPath}/${PNPM_LOCKFILE}`;
    if (!filesystem.exists(lockfile)) continue;

    filesystem.remove(lockfile);
    removed.push(subDir);
  }

  return { removed };
}
