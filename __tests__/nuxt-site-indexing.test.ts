import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  declaresPublicAppEnv,
  nuxtAppHidesNonProductionStages,
  setsIndexableOnSiteConfigInit,
} from '../src/lib/nuxt-site-indexing';

/**
 * A deployed Nuxt dev stage with `NUXT_PUBLIC_APP_ENV=develop` answered `X-Robots-Tag: index, follow`
 * (smoke test, 2026-11-26): nuxt-site-config judges indexability by its own site environment, which is
 * `production` in every build. nuxt-base-starter's `server/plugins/site-indexing.ts` now pushes
 * `indexable: false` from `site-config:init`. `lt deployment create` promises the noindex rule only
 * for an app that has such a plugin and declares `runtimeConfig.public.appEnv`, which the plugin reads
 * (Nitro applies `NUXT_PUBLIC_APP_ENV` only over a declared key), and names
 * `NUXT_PUBLIC_SITE_INDEXABLE=false` for every other.
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

// The shape nuxt-base-starter's nuxt.config.ts has declared since 2.11.0.
const STARTER_CONFIG = `const appEnv = process.env.NUXT_PUBLIC_APP_ENV || (process.env.NODE_ENV === 'development' ? 'local' : 'production');
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      // Any value other than \`production\` also makes the whole site noindex.
      appEnv,
      appVersion: '1.0.0',
    },
  },
});
`;

describe('declaresPublicAppEnv', () => {
  test("the starter's config counts, and so does an assigned value", () => {
    expect(declaresPublicAppEnv(STARTER_CONFIG)).toBe(true);
    const assigned = "export default { runtimeConfig: { public: { 'appEnv': process.env.APP_ENV } } };\n";
    expect(declaresPublicAppEnv(assigned, 'nuxt.config.mjs')).toBe(true);
  });

  test('a public block without appEnv, or appEnv in the private runtimeConfig, does not', () => {
    const noKey = "export default defineNuxtConfig({ runtimeConfig: { public: { apiUrl: '' } } });\n";
    const privateKey = "export default defineNuxtConfig({ runtimeConfig: { appEnv: 'x', public: {} } });\n";
    expect(declaresPublicAppEnv(noKey)).toBe(false);
    expect(declaresPublicAppEnv(privateKey)).toBe(false);
  });

  test('a comment or a string that only mentions the key does not', () => {
    const prose = "// runtimeConfig: { public: { appEnv } }\nexport const note = 'runtimeConfig.public.appEnv';\nexport default defineNuxtConfig({});\n";
    expect(declaresPublicAppEnv(prose)).toBe(false);
  });
});

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

  const config = (body: string) => writeFileSync(join(app, 'nuxt.config.ts'), body);

  test('an app with the plugin under server/plugins and appEnv in its public runtime config', () => {
    plugin('site-indexing.ts', STARTER_PLUGIN);
    config(STARTER_CONFIG);
    expect(nuxtAppHidesNonProductionStages(app)).toBe(true);
  });

  test('the plugin without appEnv in the config does not count: it would read an empty value', () => {
    plugin('site-indexing.ts', STARTER_PLUGIN);
    expect(nuxtAppHidesNonProductionStages(app)).toBe(false);
    config("export default defineNuxtConfig({ runtimeConfig: { public: { apiUrl: '' } } });\n");
    expect(nuxtAppHidesNonProductionStages(app)).toBe(false);
  });

  test('an app without server/plugins, or with other plugins only', () => {
    config(STARTER_CONFIG);
    expect(nuxtAppHidesNonProductionStages(app)).toBe(false);
    plugin('security-headers.ts', "export default defineNitroPlugin((n) => { n.hooks.hook('render:response', () => {}); });\n");
    expect(nuxtAppHidesNonProductionStages(app)).toBe(false);
  });

  test('files that are no plugin source are not read', () => {
    config(STARTER_CONFIG);
    plugin('README.md', STARTER_PLUGIN);
    expect(nuxtAppHidesNonProductionStages(app)).toBe(false);
  });
});
