/**
 * Project name and repository link of an ng-base-starter app.
 *
 * ng-base-starter keeps both in `src/app/shared/site.ts` (since 22.0.1), as two single-line
 * literals its own `tests/unit/site-contract.test.ts` pins:
 *
 *   export const SITE_NAME = 'Angular Base Starter';
 *   export const SITE_REPO_URL: null | string = 'https://github.com/lenneTech/ng-base-starter';
 *
 * The browser title comes from `SITE_NAME` (TitleStrategy, SSR too), and header, footer and start
 * page show the repository link only while `SITE_REPO_URL` is set. Before this, every generated
 * project was titled "Angular Base Starter" and linked to the starter's GitHub repository.
 */
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Result of {@link applyAngularSiteIdentity}. */
export type AngularSiteIdentityResult = 'changed' | 'missing' | 'unchanged' | 'unrecognised';

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
export function applyAngularSiteIdentity(appDir: string, projectName: string): AngularSiteIdentityResult {
  const siteFile = join(appDir, 'src', 'app', 'shared', 'site.ts');
  if (!existsSync(siteFile) || lstatSync(siteFile).isSymbolicLink()) return 'missing';
  const before = readFileSync(siteFile, 'utf8');
  const nameMatch = SITE_NAME_LINE.exec(before);
  if (!nameMatch || !SITE_REPO_URL_LINE.test(before)) return 'unrecognised';

  const after = before
    .replace(SITE_NAME_LINE, () => `export const SITE_NAME = ${quoteLikeOxfmt(projectName)};`)
    .replace(SITE_REPO_URL_LINE, () => 'export const SITE_REPO_URL: null | string = null;');
  if (after === before) return 'unchanged';
  writeFileSync(siteFile, after, 'utf8');

  const indexFile = join(appDir, 'src', 'index.html');
  if (existsSync(indexFile) && !lstatSync(indexFile).isSymbolicLink()) {
    const oldTitle = `<title>${escapeHtml(nameMatch[1].slice(1, -1).replace(/\\(.)/g, '$1'))}</title>`;
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
