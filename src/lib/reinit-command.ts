/**
 * Shell command for `lt npm reinit` in a project without its own `reinit` script:
 * remove the lockfile and node_modules, then install fresh.
 *
 * Deliberately no cache step. `pnpm store prune` empties the machine-wide store on APFS
 * (clone imports leave every store file with link count 1, which is exactly what prune
 * deletes), and `npm cache clean --force` / `yarn cache clean` wipe the shared caches the
 * same way — every other project then downloads again, and a parallel install loses the
 * files it is linking. A fresh resolution needs neither: deleting the lockfile is what
 * makes the package manager ask the registry again, and pnpm verifies store integrity
 * on every install.
 */
export function buildReinitCommand(opts: { dir: string; install: string; lockfile: string }): string {
  const { dir, install, lockfile } = opts;
  return `cd ${dir} && rimraf ${lockfile} && rimraf node_modules && ${install}`;
}
