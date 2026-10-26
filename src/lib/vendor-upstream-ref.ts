import * as semver from 'semver';

/** True when `git clone --branch <ref>` failed because the ref does not exist upstream. */
export function isMissingCloneRef(gitError: string): boolean {
  return /Remote branch .* not found|did not match any file\(s\) known to git|couldn't find remote ref/i.test(gitError);
}

/**
 * Which nest-server to vendor when no `--framework-upstream-branch` is given.
 *
 * The vendor conversion used to clone nest-server's GitHub default branch (`develop`), i.e.
 * pushed but unpublished work, while npm mode installs the version the starter pins. Now
 * both modes start from the same framework version: the one the starter was released and
 * tested with. `lt server convert-mode --to vendor` already did this, it passes the
 * installed version. nest-server tags carry no `v` prefix (`11.43.3`), so the pin is the tag.
 *
 * Only an exact version counts. A range names no single release, so it returns `undefined`
 * and the caller keeps the default branch, as for a project that does not declare the
 * framework at all.
 */
export function starterPinnedFrameworkVersion(pkg: unknown): string | undefined {
  if (!pkg || typeof pkg !== 'object') return undefined;
  const manifest = pkg as Record<string, any>;
  const pin =
    manifest.dependencies?.['@lenne.tech/nest-server'] ?? manifest.devDependencies?.['@lenne.tech/nest-server'];
  return typeof pin === 'string' && semver.valid(pin) ? pin : undefined;
}
