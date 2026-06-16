import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildIdentity, buildTestIdentity, DevIdentity, isUnmodifiedTemplateName, projectSlug, slugify } from '../src/lib/dev-identity';

describe('dev-identity', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lt-dev-identity-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('slugify', () => {
    test('lowercase + alphanumerics + dashes', () => {
      expect(slugify('My Project')).toBe('my-project');
      expect(slugify('@lenne.tech/foo')).toBe('lenne-tech-foo');
      expect(slugify('CRM 2.0!')).toBe('crm-2-0');
      expect(slugify('--leading-trailing--')).toBe('leading-trailing');
    });
    test('empty + edge cases', () => {
      expect(slugify('')).toBe('');
      expect(slugify('___')).toBe('');
    });
  });

  describe('projectSlug', () => {
    test('reads from package.json name', () => {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'crm' }));
      expect(projectSlug(tmp)).toBe('crm');
    });
    test('strips npm scope', () => {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: '@lenne.tech/crm' }));
      expect(projectSlug(tmp)).toBe('crm');
    });
    test('falls back to dirname when no package.json', () => {
      const dirOnly = mkdtempSync(join(tmpdir(), 'fallback-name-'));
      try {
        const slug = projectSlug(dirOnly);
        expect(slug).toMatch(/^fallback-name-[a-z0-9]+$/);
      } finally {
        rmSync(dirOnly, { recursive: true, force: true });
      }
    });
    test('handles malformed package.json', () => {
      writeFileSync(join(tmp, 'package.json'), '{ broken');
      expect(projectSlug(tmp)).toMatch(/^lt-dev-identity-/);
    });
    test('ignores an unmodified starter-template name → falls back to the directory', () => {
      // Older projects (scaffolded before rename-on-init) keep the template's
      // `lt-monorepo` name. The slug must come from the project folder (`imo`),
      // not the placeholder — otherwise every such project collides on
      // `lt-monorepo.localhost` and `lt ticket` builds `lt-monorepo-2314`.
      const parent = mkdtempSync(join(tmpdir(), 'lt-tpl-name-'));
      const projectDir = join(parent, 'imo');
      mkdirSync(projectDir);
      writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'lt-monorepo' }));
      try {
        expect(projectSlug(projectDir)).toBe('imo');
      } finally {
        rmSync(parent, { force: true, recursive: true });
      }
    });
  });

  describe('isUnmodifiedTemplateName', () => {
    test('matches known starter-template defaults', () => {
      expect(isUnmodifiedTemplateName('lt-monorepo')).toBe(true);
    });
    test('rejects custom names and falsy values', () => {
      expect(isUnmodifiedTemplateName('imo')).toBe(false);
      expect(isUnmodifiedTemplateName('crm')).toBe(false);
      expect(isUnmodifiedTemplateName('')).toBe(false);
      expect(isUnmodifiedTemplateName(null)).toBe(false);
      expect(isUnmodifiedTemplateName(undefined)).toBe(false);
    });
  });

  describe('buildIdentity — monorepo', () => {
    test('detects projects/api + projects/app', () => {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'crm' }));
      mkdirSync(join(tmp, 'projects', 'api'), { recursive: true });
      mkdirSync(join(tmp, 'projects', 'app'), { recursive: true });

      const id = buildIdentity(tmp);
      expect(id.slug).toBe('crm');
      expect(id.subdomains.api?.hostname).toBe('api.crm.localhost');
      expect(id.subdomains.api?.isPrimaryApp).toBe(false);
      expect(id.subdomains.app?.hostname).toBe('crm.localhost');
      expect(id.subdomains.app?.isPrimaryApp).toBe(true);
    });
    test('only api dir present → only api subdomain', () => {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'api-only' }));
      mkdirSync(join(tmp, 'projects', 'api'), { recursive: true });
      const id = buildIdentity(tmp);
      expect(id.subdomains.api).toBeDefined();
      expect(id.subdomains.app).toBeUndefined();
    });
  });

  describe('buildIdentity — standalone', () => {
    test('standalone API (config.env.ts)', () => {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'svc' }));
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), '');
      const id = buildIdentity(tmp);
      expect(id.subdomains.api?.hostname).toBe('api.svc.localhost');
      expect(id.subdomains.app).toBeUndefined();
    });
    test('standalone App (nuxt.config.ts)', () => {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'web' }));
      writeFileSync(join(tmp, 'nuxt.config.ts'), '');
      const id = buildIdentity(tmp);
      expect(id.subdomains.app?.hostname).toBe('web.localhost');
      expect(id.subdomains.app?.isPrimaryApp).toBe(true);
    });
    test('nest-cli.json triggers API detection too', () => {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'nest' }));
      writeFileSync(join(tmp, 'nest-cli.json'), '{}');
      const id = buildIdentity(tmp);
      expect(id.subdomains.api?.hostname).toBe('api.nest.localhost');
    });
  });

  describe('buildTestIdentity', () => {
    const base: DevIdentity = {
      root: '/tmp/svl',
      slug: 'svl',
      subdomains: {
        api: { hostname: 'api.svl.localhost', isPrimaryApp: false, subdir: 'projects/api' },
        app: { hostname: 'svl.localhost', isPrimaryApp: true, subdir: 'projects/app' },
      },
    };

    test('suffixes slug and rewrites every hostname', () => {
      const test = buildTestIdentity(base);
      expect(test.slug).toBe('svl-test');
      // Primary app collapses to `<slug>-test.localhost` …
      expect(test.subdomains.app.hostname).toBe('svl-test.localhost');
      expect(test.subdomains.app.isPrimaryApp).toBe(true);
      // … while non-primary subdomains keep their sub-prefix.
      expect(test.subdomains.api.hostname).toBe('api.svl-test.localhost');
      expect(test.subdomains.api.isPrimaryApp).toBe(false);
    });

    test('preserves root + subdir + non-name fields', () => {
      const test = buildTestIdentity(base);
      expect(test.root).toBe(base.root);
      expect(test.subdomains.api.subdir).toBe('projects/api');
      expect(test.subdomains.app.subdir).toBe('projects/app');
    });

    test('custom suffix is honored', () => {
      const test = buildTestIdentity(base, '-ci');
      expect(test.slug).toBe('svl-ci');
      expect(test.subdomains.app.hostname).toBe('svl-ci.localhost');
      expect(test.subdomains.api.hostname).toBe('api.svl-ci.localhost');
    });

    test('idempotent across distinct subdomains beyond api/app', () => {
      const richer: DevIdentity = {
        root: '/tmp/svl',
        slug: 'svl',
        subdomains: {
          ...base.subdomains,
          admin: { hostname: 'admin.svl.localhost', isPrimaryApp: false, subdir: 'projects/admin' },
        },
      };
      const test = buildTestIdentity(richer);
      expect(test.subdomains.admin.hostname).toBe('admin.svl-test.localhost');
    });
  });
});
