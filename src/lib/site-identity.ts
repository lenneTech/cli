/**
 * Project name and repository link of a frontend made from a lenne.Tech starter.
 *
 * Both starters keep them in one file, as two single-line literals their own contract tests pin:
 *
 *   export const SITE_NAME = 'Angular Base Starter';
 *   export const SITE_REPO_URL: null | string = 'https://github.com/lenneTech/ng-base-starter';
 *
 * - ng-base-starter (since 22.0.1): `src/app/shared/site.ts`. The browser title comes from
 *   `SITE_NAME` (TitleStrategy, SSR too); `src/index.html` carries a static `<title>` fallback.
 * - nuxt-base-starter (DEV-4132): `app/utils/site.ts`. `nuxt.config.ts` reads `SITE_NAME` for the
 *   head title and the header.
 *
 * Header, footer and start page show the repository link only while `SITE_REPO_URL` is set. Before
 * this, every generated project was titled after the starter and linked to its GitHub repository.
 */
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Result of {@link applyAngularSiteIdentity} and {@link applyNuxtSiteIdentity}. */
export type SiteIdentityResult = 'changed' | 'missing' | 'unchanged' | 'unrecognised';

// Either quote: the project's formatter (oxfmt) turns `'Kai\'s Shop'` into `"Kai's Shop"`.
const SITE_NAME_LINE = /^export const SITE_NAME = ('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*");$/m;
const SITE_REPO_URL_LINE = /^export const SITE_REPO_URL: null \| string = (?:'(?:[^'\\\n]|\\.)*'|null);$/m;

/**
 * Sets `SITE_NAME` to the project name and `SITE_REPO_URL` to null, plus the static `<title>`
 * fallback in `src/index.html` while it still shows the starter's name. Never writes through a
 * symlink (a `--frontend-link` app is the developer's own checkout).
 * @param appDir - The Angular app (repository root of the starter)
 * @param projectName - Name of the new project
 * @returns `unrecognised` when site.ts does not carry both lines in the shape above (left untouched)
 */
export function applyAngularSiteIdentity(appDir: string, name: string): SiteIdentityResult {
  // gluegun parses a digit-only `--name 2025` as a number.
  const projectName = String(name);
  const { oldName, result } = applySiteFile(join(appDir, 'src', 'app', 'shared', 'site.ts'), projectName);
  if (result !== 'changed') return result;

  const indexFile = join(appDir, 'src', 'index.html');
  if (existsSync(indexFile) && !lstatSync(indexFile).isSymbolicLink()) {
    const oldTitle = `<title>${escapeHtml(oldName)}</title>`;
    const html = readFileSync(indexFile, 'utf8');
    if (html.includes(oldTitle)) {
      writeFileSync(
        indexFile,
        html.replace(oldTitle, () => `<title>${escapeHtml(projectName)}</title>`),
        'utf8',
      );
    }
  }
  return 'changed';
}

/**
 * Sets `SITE_NAME` to the project name and `SITE_REPO_URL` to null in `app/utils/site.ts`. The head
 * title follows from it (`nuxt.config.ts` reads the file), so nothing else is rewritten. A starter
 * without the file (older releases, the `next` branch) reports `missing`.
 * @param appDir - The Nuxt app (the flattened `nuxt-base-template/`)
 * @param projectName - Name of the new project
 * @returns `unrecognised` when site.ts does not carry both lines in the shape above (left untouched)
 */
export function applyNuxtSiteIdentity(appDir: string, name: string): SiteIdentityResult {
  // gluegun parses a digit-only `--name 2025` as a number.
  return applySiteFile(join(appDir, 'app', 'utils', 'site.ts'), String(name)).result;
}

/** Rewrites the two lines of one site file; `oldName` is the unquoted name it replaced. */
function applySiteFile(siteFile: string, projectName: string): { oldName: string; result: SiteIdentityResult } {
  if (!existsSync(siteFile) || lstatSync(siteFile).isSymbolicLink()) return { oldName: '', result: 'missing' };
  const before = readFileSync(siteFile, 'utf8');
  const nameMatch = SITE_NAME_LINE.exec(before);
  if (!nameMatch || !SITE_REPO_URL_LINE.test(before)) return { oldName: '', result: 'unrecognised' };

  const after = before
    .replace(SITE_NAME_LINE, () => `export const SITE_NAME = ${quoteLikeOxfmt(projectName)};`)
    .replace(SITE_REPO_URL_LINE, () => 'export const SITE_REPO_URL: null | string = null;');
  if (after === before) return { oldName: '', result: 'unchanged' };
  writeFileSync(siteFile, after, 'utf8');
  return { oldName: nameMatch[1].slice(1, -1).replace(/\\(.)/g, '$1'), result: 'changed' };
}

/** Escapes text for an HTML text node. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A TypeScript string literal in the form oxfmt prints it: single quotes, double quotes when the
 * text contains a single quote and no double quote. Written that way, a read-only
 * `check --no-fix` passes on the new project.
 */
function quoteLikeOxfmt(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\');
  if (text.includes("'") && !text.includes('"')) return `"${escaped}"`;
  return `'${escaped.replace(/'/g, "\\'")}'`;
}
