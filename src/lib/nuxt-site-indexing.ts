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
 * The plugin reads `runtimeConfig.public.appEnv`, and Nitro applies `NUXT_PUBLIC_APP_ENV` only over a
 * key the config declares. A project that copied the plugin into an app without that key (one
 * generated before nuxt-base-starter 2.11.0) reads an empty value on every stage, takes it for
 * production, and stays indexable.
 *
 * `lt deployment create` serves projects from before and after that plugin, so it promises the noindex
 * rule only where the app carries the plugin AND declares the key, and names
 * `NUXT_PUBLIC_SITE_INDEXABLE=false` elsewhere. A missed detection only costs that extra, harmless hint.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

type Ts = typeof import('typescript');
type TsNode = import('typescript').Node;

const NUXT_CONFIG_FILES = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'];
const PLUGIN_FILE = /\.(?:[cm]?[jt]s)$/;

/**
 * True when `source` declares `appEnv` directly in a `runtimeConfig.public` object literal
 * (`public: { appEnv }` or `public: { appEnv: … }`). Read from the AST, so a comment or a string that
 * only mentions the key never counts, and neither does an `appEnv` in the private `runtimeConfig`.
 * @param source - Content of `nuxt.config.*`
 * @param fileName - Used only to pick the parser's script kind
 */
export function declaresPublicAppEnv(source: string, fileName = 'nuxt.config.ts'): boolean {
  const ts = loadTypeScript();
  const sf = parse(ts, source, fileName);

  const objectProperty = (object: import('typescript').ObjectLiteralExpression, name: string) =>
    object.properties.find(
      (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && propertyName(ts, p.name) === name,
    );

  const visit = (node: TsNode): boolean => {
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(ts, node.name) === 'runtimeConfig' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const pub = objectProperty(node.initializer, 'public');
      if (
        pub &&
        ts.isPropertyAssignment(pub) &&
        ts.isObjectLiteralExpression(pub.initializer) &&
        objectProperty(pub.initializer, 'appEnv')
      ) {
        return true;
      }
    }
    return ts.forEachChild(node, visit) === true;
  };

  return visit(sf);
}

/**
 * True when `<appDir>/server/plugins/` holds a file that calls `<x>.hook('site-config:init', …)` and
 * sets an `indexable` property inside that call, and the app's `nuxt.config.*` declares
 * `runtimeConfig.public.appEnv`, which that plugin reads. Both are read from the AST.
 * @param appDir - The Nuxt app (`projects/app` in a workspace)
 */
export function nuxtAppHidesNonProductionStages(appDir: string): boolean {
  return hasSiteIndexingPlugin(appDir) && hasPublicAppEnv(appDir);
}

/**
 * True when `source` calls `<x>.hook('site-config:init', …)` and an `indexable` property is set inside
 * the call's arguments.
 * @param source - File content
 * @param fileName - Used only to pick the parser's script kind
 */
export function setsIndexableOnSiteConfigInit(source: string, fileName = 'plugin.ts'): boolean {
  const ts = loadTypeScript();
  const sf = parse(ts, source, fileName);

  const setsIndexable = (node: TsNode): boolean => {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      propertyName(ts, node.name) === 'indexable'
    ) {
      return true;
    }
    return ts.forEachChild(node, setsIndexable) === true;
  };

  const visit = (node: TsNode): boolean => {
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

function hasPublicAppEnv(appDir: string): boolean {
  return NUXT_CONFIG_FILES.some((name) => {
    const file = join(appDir, name);
    if (!existsSync(file)) return false;
    try {
      return declaresPublicAppEnv(readFileSync(file, 'utf8'), name);
    } catch {
      return false;
    }
  });
}

function hasSiteIndexingPlugin(appDir: string): boolean {
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

function loadTypeScript(): Ts {
  // Lazy: gluegun loads every command module on every `lt` run, and TypeScript is large.
  return require('typescript') as Ts;
}

function parse(ts: Ts, source: string, fileName: string): import('typescript').SourceFile {
  const kind = /\.[cm]?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);
}

function propertyName(ts: Ts, name: import('typescript').PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}
