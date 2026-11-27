import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { nuxtAppHidesNonProductionStages, setsIndexableOnSiteConfigInit } from '../src/lib/nuxt-site-indexing';

/**
 * A deployed Nuxt dev stage with `NUXT_PUBLIC_APP_ENV=develop` answered `X-Robots-Tag: index, follow`
 * (smoke test, 2026-11-26): nuxt-site-config judges indexability by its own site environment, which is
 * `production` in every build. nuxt-base-starter's `server/plugins/site-indexing.ts` now pushes
 * `indexable: false` from `site-config:init`. `lt deployment create` promises the noindex rule only
 * for an app that has such a plugin, and names `NUXT_PUBLIC_SITE_INDEXABLE=false` for every other.
 */
const STARTER_PLUGIN = `/**
 * Keep a deployment outside production out of search engines' index.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('site-config:init', ({ siteConfig }) => {
    if (appEnvBlocksIndexing(useRuntimeConfig().public.appEnv, process.env)) {
      siteConfig.push({ _context: 'nuxt-base-starter:app-env', _priority: 0, indexable: false });
    }
  });
});
`;

describe('setsIndexableOnSiteConfigInit', () => {
  test("the starter's plugin counts", () => {
    expect(setsIndexableOnSiteConfigInit(STARTER_PLUGIN)).toBe(true);
  });

  test('a shorthand `indexable` and a plain JS plugin count', () => {
    const js = "export default (app) => { app.hooks.hook('site-config:init', ({ siteConfig }) => { const indexable = false; siteConfig.push({ indexable }); }); };\n";
    expect(setsIndexableOnSiteConfigInit(js, 'indexing.mjs')).toBe(true);
  });

  test('a comment or a string that only mentions the hook does not', () => {
    const prose = "// nitroApp.hooks.hook('site-config:init', () => ({ indexable: false }))\nexport const note = \"hook('site-config:init') sets indexable\";\nexport default defineNitroPlugin(() => {});\n";
    expect(setsIndexableOnSiteConfigInit(prose)).toBe(false);
  });

  test('the hook without `indexable`, or `indexable` in another hook, does not', () => {
    const otherKey = "export default defineNitroPlugin((n) => { n.hooks.hook('site-config:init', ({ siteConfig }) => siteConfig.push({ name: 'x' })); });\n";
    const otherHook = "export default defineNitroPlugin((n) => { n.hooks.hook('render:html', () => ({ indexable: false })); });\n";
    expect(setsIndexableOnSiteConfigInit(otherKey)).toBe(false);
    expect(setsIndexableOnSiteConfigInit(otherHook)).toBe(false);
  });
});

describe('nuxtAppHidesNonProductionStages', () => {
  let app: string;
  beforeEach(() => {
    app = mkdtempSync(join(tmpdir(), 'lt-nuxt-indexing-'));
  });
  afterEach(() => {
    rmSync(app, { force: true, recursive: true });
  });

  const plugin = (name: string, body: string) => {
    mkdirSync(join(app, 'server', 'plugins'), { recursive: true });
    writeFileSync(join(app, 'server', 'plugins', name), body);
  };

  test('an app with the plugin under server/plugins', () => {
    plugin('site-indexing.ts', STARTER_PLUGIN);
    expect(nuxtAppHidesNonProductionStages(app)).toBe(true);
  });

  test('an app without server/plugins, or with other plugins only', () => {
    expect(nuxtAppHidesNonProductionStages(app)).toBe(false);
    plugin('security-headers.ts', "export default defineNitroPlugin((n) => { n.hooks.hook('render:response', () => {}); });\n");
    expect(nuxtAppHidesNonProductionStages(app)).toBe(false);
  });

  test('files that are no plugin source are not read', () => {
    plugin('README.md', STARTER_PLUGIN);
    expect(nuxtAppHidesNonProductionStages(app)).toBe(false);
  });
});
