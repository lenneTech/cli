/**
 * Pure, I/O-free helpers behind `lt deployment create`.
 *
 * Extracted from the command so the branch-heavy logic (option parsing, the
 * malformed-JSON guard, slug/domain validation, and the merge-not-clobber of
 * `.turboops.json`) is unit-testable without spawning the CLI. The command
 * keeps the spinner / prompt / filesystem side effects and delegates the
 * decisions here.
 */
import type { GluegunFilesystem } from 'gluegun';

/**
 * A plausible multi-label hostname (e.g. `myproject.lenne.tech`).
 *
 * The deploy `domain` is written VERBATIM into generated Angular
 * `environment.*.ts` (which `ng build` bakes into the browser bundle) and into
 * copy-paste checklist lines. A stray quote / `$` / `;` / whitespace would break
 * out of the generated string literal (code injection into the bundle) or emit a
 * non-compiling config, so the value is restricted to hostname characters at the
 * input boundary.
 */
export const DOMAIN_PATTERN =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * TurboOps project slugs are the registry namespace + the `docker login` user,
 * so `registry.turbo-ops.de/<project>` and `docker login -u "$TURBOOPS_PROJECT"`
 * only accept a lowercase dash-separated slug.
 */
export const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** True when `domain` is a plausible multi-label hostname. */
export function isValidDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain);
}

/** True when `slug` is a usable TurboOps project slug. */
export function isValidProjectSlug(slug: string): boolean {
  return PROJECT_SLUG_PATTERN.test(slug);
}

/**
 * Compute the merged `.turboops.json` content for a target `project` slug,
 * WITHOUT any I/O. The file is committed and a user may have added keys by hand,
 * so a re-run must MERGE, never clobber:
 *
 * - no existing config → a fresh `{ project }`;
 * - existing config that is already exactly `{ project }` → `changed: false`
 *   (caller skips the write and reports "up to date");
 * - otherwise → `{ ...existing, project }` with `changed: true` (user keys kept).
 *
 * `previousProject` is the prior `project` value when it was a string, so the
 * caller can warn on a project rename.
 */
export function mergeTurboOpsConfig(
  existing: Record<string, unknown> | undefined,
  project: string,
): { changed: boolean; config: Record<string, unknown>; previousProject?: string } {
  if (!existing) {
    return { changed: true, config: { project } };
  }
  const previousProject = typeof existing.project === 'string' ? existing.project : undefined;
  const upToDate = existing.project === project && Object.keys(existing).length === 1;
  if (upToDate) {
    return { changed: false, config: existing, previousProject };
  }
  return { changed: true, config: { ...existing, project }, previousProject };
}

/**
 * Read a CLI option as a string. gluegun parses a valueless `--project` as the
 * boolean `true`; passing that straight through would write `{"project":"true"}`
 * and point the pipeline at the registry namespace `true`. Whitespace-only is
 * treated as absent.
 */
export function optionString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read a JSON file without throwing. gluegun's `filesystem.read(path, 'json')`
 * THROWS on malformed JSON (it does NOT return undefined), so every read of a
 * hand-editable file has to guard for it or the whole command crashes with an
 * uncaught stack trace mid-spinner.
 *
 * `found` distinguishes "file is absent" from "file exists but is unusable";
 * `value` is only set when the file parsed into a plain object (a bare `null`,
 * number, or array is valid JSON but cannot hold our keys, so it counts as
 * unusable, not as a config).
 */
export function readJsonObject(
  filesystem: GluegunFilesystem,
  path: string,
): { found: boolean; value?: Record<string, unknown> } {
  if (filesystem.exists(path) !== 'file') return { found: false };
  try {
    const value = filesystem.read(path, 'json');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { found: true, value: value as Record<string, unknown> }
      : { found: true };
  } catch {
    return { found: true };
  }
}
