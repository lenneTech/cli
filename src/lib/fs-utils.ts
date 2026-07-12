import { lstatSync } from 'fs';

/**
 * Whether `path` is a symbolic link (false on any stat error).
 *
 * Shared by the workspace-normalization helpers that must not mutate a
 * `--api-link` / `--frontend-link` sub-project pointing at the user's own
 * checkout.
 */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
