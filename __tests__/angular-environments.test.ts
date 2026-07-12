import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { findAngularEnvironmentsDir, patchAngularEnvironments, stageHosts } from '../src/lib/angular-environments';

/** Verbatim shape of an ng-base-starter environment file. */
const STARTER_ENV = `export const environment = {
  production: true,
  logoPath: 'https://de.expensereduction.com/wp-content/uploads/2018/02/logo-placeholder.png',

  // Settings for @lenne.tech/ng-base
  prefix: 'app',
  apiUrl: 'http://127.0.0.1:3000/graphql',
  wsUrl: 'ws://127.0.0.1:3000/graphql',
  restUrl: 'http://127.0.0.1:3000/api',
  appUrl: 'http://127.0.0.1:4200',
  authGuardRedirectUrl: '/auth',
  logging: false,
};
`;

describe('angular-environments', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lt-ng-env-'));
  });
  afterEach(() => {
    rmSync(tmp, { force: true, recursive: true });
  });

  /** Create `projects/app/src/environments` with the given files. */
  const scaffold = (files: string[]): string => {
    const dir = join(tmp, 'projects', 'app', 'src', 'environments');
    mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(join(dir, f), STARTER_ENV);
    return dir;
  };
  const readEnv = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');

  describe('stageHosts', () => {
    test('production maps to the apex domain', () => {
      expect(stageHosts('acme.lenne.tech', 'production')).toEqual({
        api: 'api.acme.lenne.tech',
        app: 'acme.lenne.tech',
      });
    });
    test('dev nests the api one label deeper', () => {
      expect(stageHosts('acme.lenne.tech', 'dev')).toEqual({
        api: 'api.dev.acme.lenne.tech',
        app: 'dev.acme.lenne.tech',
      });
    });
  });

  describe('findAngularEnvironmentsDir', () => {
    test('finds the monorepo location', () => {
      const dir = scaffold([]);
      expect(findAngularEnvironmentsDir(tmp)).toBe(dir);
    });
    test('finds the standalone location', () => {
      const dir = join(tmp, 'src', 'environments');
      mkdirSync(dir, { recursive: true });
      expect(findAngularEnvironmentsDir(tmp)).toBe(dir);
    });
    test('null for a non-Angular project (Nuxt)', () => {
      writeFileSync(join(tmp, 'nuxt.config.ts'), '');
      expect(findAngularEnvironmentsDir(tmp)).toBeNull();
    });
  });

  describe('patchAngularEnvironments', () => {
    test('no-op (empty result) for a Nuxt project', () => {
      writeFileSync(join(tmp, 'nuxt.config.ts'), '');
      expect(patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp })).toEqual([]);
    });

    test('environment.prod.ts gets the production URLs', () => {
      const dir = scaffold(['environment.prod.ts']);
      const results = patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp });
      expect(results).toHaveLength(1);
      expect(results[0].patched).toBe(true);

      const content = readEnv(dir, 'environment.prod.ts');
      expect(content).toContain("apiUrl: 'https://api.acme.lenne.tech/graphql'");
      expect(content).toContain("wsUrl: 'wss://api.acme.lenne.tech/graphql'");
      expect(content).toContain("restUrl: 'https://api.acme.lenne.tech/api'");
      expect(content).toContain("appUrl: 'https://acme.lenne.tech'");
      expect(content).not.toContain('127.0.0.1');
    });

    test('environment.develop.ts and environment.test.ts get the dev-stage URLs', () => {
      const dir = scaffold(['environment.develop.ts', 'environment.test.ts']);
      patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp });

      for (const file of ['environment.develop.ts', 'environment.test.ts']) {
        const content = readEnv(dir, file);
        expect(content).toContain("apiUrl: 'https://api.dev.acme.lenne.tech/graphql'");
        expect(content).toContain("wsUrl: 'wss://api.dev.acme.lenne.tech/graphql'");
        expect(content).toContain("appUrl: 'https://dev.acme.lenne.tech'");
      }
    });

    test('environment.ts (local dev) is never touched', () => {
      const dir = scaffold(['environment.prod.ts']);
      writeFileSync(join(dir, 'environment.ts'), STARTER_ENV);
      patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp });
      expect(readEnv(dir, 'environment.ts')).toBe(STARTER_ENV);
    });

    test('preserves the path so a customised route survives', () => {
      const dir = scaffold([]);
      writeFileSync(join(dir, 'environment.prod.ts'), "export const environment = { apiUrl: 'http://127.0.0.1:3000/v2/graphql' };\n");
      patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp });
      expect(readEnv(dir, 'environment.prod.ts')).toContain("apiUrl: 'https://api.acme.lenne.tech/v2/graphql'");
    });

    test('leaves unrelated URLs (logoPath) alone', () => {
      const dir = scaffold(['environment.prod.ts']);
      patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp });
      expect(readEnv(dir, 'environment.prod.ts')).toContain(
        "logoPath: 'https://de.expensereduction.com/wp-content/uploads/2018/02/logo-placeholder.png'",
      );
    });

    test('is idempotent — a second run reports no replacements', () => {
      scaffold(['environment.prod.ts']);
      expect(patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp })[0].replacements).toBe(4);
      const second = patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp })[0];
      expect(second.patched).toBe(false);
      expect(second.replacements).toBe(0);
    });

    // The old `http://127.0.0.1:3000`-only replace silently did NOTHING here,
    // leaving the previous domain baked into the bundle.
    test('a re-run with a new domain rewrites the already-deployed URLs', () => {
      const dir = scaffold(['environment.prod.ts']);
      patchAngularEnvironments({ domain: 'old.lenne.tech', projectRoot: tmp });
      const result = patchAngularEnvironments({ domain: 'new.lenne.tech', projectRoot: tmp })[0];

      expect(result.patched).toBe(true);
      const content = readEnv(dir, 'environment.prod.ts');
      expect(content).toContain("apiUrl: 'https://api.new.lenne.tech/graphql'");
      expect(content).not.toContain('old.lenne.tech');
    });

    test('skips environment files that do not exist', () => {
      scaffold(['environment.prod.ts']);
      expect(patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp })).toHaveLength(1);
    });

    // `recognized` disambiguates "already correct" from "no URL to rewrite":
    // a starter env has rewritable URLs (recognized), a stripped one does not.
    test('reports recognized=true for a file with rewritable URLs', () => {
      scaffold(['environment.prod.ts']);
      const result = patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp })[0];
      expect(result.recognized).toBe(true);
      // A second run leaves it unchanged but the URLs are still recognized.
      const second = patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp })[0];
      expect(second.patched).toBe(false);
      expect(second.recognized).toBe(true);
    });

    test('reports recognized=false when no rewritable URL property is present', () => {
      const dir = scaffold([]);
      writeFileSync(join(dir, 'environment.prod.ts'), "export const environment = { production: true };\n");
      const result = patchAngularEnvironments({ domain: 'acme.lenne.tech', projectRoot: tmp })[0];
      expect(result.patched).toBe(false);
      expect(result.recognized).toBe(false);
    });
  });
});
