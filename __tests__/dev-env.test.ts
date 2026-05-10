import { buildDevEnv } from '../src/lib/dev-env';
import { DevIdentity } from '../src/lib/dev-identity';

const fullIdentity: DevIdentity = {
  root: '/tmp/fake',
  slug: 'crm',
  subdomains: {
    api: { hostname: 'api.crm.localhost', isPrimaryApp: false, subdir: 'projects/api' },
    app: { hostname: 'crm.localhost', isPrimaryApp: true, subdir: 'projects/app' },
  },
};

describe('dev-env / buildDevEnv', () => {
  test('sets URL-based env for both API and App', () => {
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, dbName: 'crm', identity: fullIdentity });
    expect(env.api.env.PORT).toBe('4010');
    expect(env.api.env.BASE_URL).toBe('https://api.crm.localhost');
    expect(env.api.env.NSC__BASE_URL).toBe('https://api.crm.localhost');
    expect(env.api.env.APP_URL).toBe('https://crm.localhost');
    expect(env.api.env.NSC__APP_URL).toBe('https://crm.localhost');
    expect(env.api.env.NSC__MONGOOSE__URI).toBe('mongodb://127.0.0.1/crm');
    expect(env.api.env.DATABASE_URL).toContain('crm');

    expect(env.app.env.PORT).toBe('4011');
    expect(env.app.env.NUXT_API_URL).toBe('https://api.crm.localhost');
    expect(env.app.env.NUXT_PUBLIC_API_URL).toBe('https://api.crm.localhost');
    expect(env.app.env.NUXT_PUBLIC_SITE_URL).toBe('https://crm.localhost');
    expect(env.app.env.NUXT_PUBLIC_STORAGE_PREFIX).toBe('crm');
  });

  test('NUXT_PUBLIC_API_PROXY defaults to false (Caddy makes vite-proxy obsolete)', () => {
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });
    expect(env.app.env.NUXT_PUBLIC_API_PROXY).toBe('false');
  });

  test('inherits baseEnv (e.g. PATH) so user-set vars survive', () => {
    const env = buildDevEnv({
      apiInternalPort: 4010,
      appInternalPort: 4011,
      baseEnv: { CUSTOM_TOKEN: 'abc', PATH: '/usr/bin' },
      identity: fullIdentity,
    });
    expect(env.api.env.CUSTOM_TOKEN).toBe('abc');
    expect(env.api.env.PATH).toBe('/usr/bin');
    expect(env.app.env.PATH).toBe('/usr/bin');
  });

  test('omits DB env when no dbName given', () => {
    const env = buildDevEnv({ apiInternalPort: 4010, appInternalPort: 4011, identity: fullIdentity });
    expect(env.api.env.NSC__MONGOOSE__URI).toBeUndefined();
    expect(env.api.env.DATABASE_URL).toBeUndefined();
  });

  test('omits api/app URL keys when subdomain missing', () => {
    const apiOnly: DevIdentity = {
      root: '/tmp/fake',
      slug: 'svc',
      subdomains: {
        api: { hostname: 'api.svc.localhost', isPrimaryApp: false, subdir: null },
      },
    };
    const env = buildDevEnv({ apiInternalPort: 4020, appInternalPort: 0, identity: apiOnly });
    expect(env.api.env.BASE_URL).toBe('https://api.svc.localhost');
    expect(env.app.env.NUXT_PUBLIC_SITE_URL).toBeUndefined();
  });
});
