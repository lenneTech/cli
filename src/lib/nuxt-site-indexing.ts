/**
 * Whether a Nuxt app keeps a stage outside production out of search engines' index.
 *
 * nuxt-site-config decides indexability by its own site environment (`indexable`, otherwise
 * `env === 'production'`), and outside `nuxt dev` that environment is `production` for every build.
 * `NUXT_PUBLIC_APP_ENV=develop` alone therefore left a deployed dev stage indexable (measured on the
 * 2026-11-26 smoke test: `X-Robots-Tag: index, follow`), while the Angular starter's stage with
 * `NG_PUBLIC_APP_ENV=develop` answered `noindex, nofollow`. nuxt-base-starter now ships a Nitro plugin
 * (`server/plugins/site-indexing.ts`) that pushes `indexable: false` from the `site-config:init` hook
 * whenever the app environment is not `production`.
 *
 * `lt deployment create` serves projects from before and after that plugin, so it promises the noindex
 * rule only where the app carries it, and names `NUXT_PUBLIC_SITE_INDEXABLE=false` elsewhere.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const PLUGIN_FILE = /\.(?:[cm]?[jt]s)$/;

/**
 * True when a file in `<appDir>/server/plugins/` calls `<x>.hook('site-config:init', …)` and sets an
 * `indexable` property inside that call. Read from the AST, so a comment or a string that only
 * mentions the hook never counts.
 * @param appDir - The Nuxt app (`projects/app` in a workspace)
 */
export function nuxtAppHidesNonProductionStages(appDir: string): boolean {
  const dir = join(appDir, 'server', 'plugins');
  if (!existsSync(dir)) return false;
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => PLUGIN_FILE.test(name));
  } catch {
    return false;
  }
  return names.some((name) => {
    try {
      return setsIndexableOnSiteConfigInit(readFileSync(join(dir, name), 'utf8'), name);
    } catch {
      return false;
    }
  });
}

/**
 * True when `source` calls `<x>.hook('site-config:init', …)` and an `indexable` property is set inside
 * the call's arguments.
 * @param source - File content
 * @param fileName - Used only to pick the parser's script kind
 */
export function setsIndexableOnSiteConfigInit(source: string, fileName = 'plugin.ts'): boolean {
  // Lazy: gluegun loads every command module on every `lt` run, and TypeScript is large.
  const ts = require('typescript') as typeof import('typescript');
  const kind = /\.[cm]?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);

  const setsIndexable = (node: import('typescript').Node): boolean => {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'indexable'
    ) {
      return true;
    }
    return ts.forEachChild(node, setsIndexable) === true;
  };

  const visit = (node: import('typescript').Node): boolean => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'hook' &&
      node.arguments.length > 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === 'site-config:init' &&
      node.arguments.slice(1).some(setsIndexable)
    ) {
      return true;
    }
    return ts.forEachChild(node, visit) === true;
  };

  return visit(sf);
}
