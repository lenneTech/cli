import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { filesystem } from 'gluegun';
import { tmpdir } from 'os';
import { join } from 'path';

import { FrontendHelper } from '../src/extensions/frontend-helper';

/**
 * `FrontendHelper#patchFrontendEnv`, run by `lt fullstack init` and `add-app` on the new app.
 *
 * Only an Angular app gets a project-specific storage prefix: ng-base's `LtStorageService` reads
 * `NG_PUBLIC_STORAGE_PREFIX`. Nothing in the Nuxt stack reads `NUXT_PUBLIC_STORAGE_PREFIX`
 * (nuxt-base-starter 4.0.7 dropped it from `.env.example`), so a line from an older template is
 * left as it is rather than rewritten into something that looks meaningful.
 */
describe('FrontendHelper#patchFrontendEnv', () => {
  let app: string;
  const helper = new FrontendHelper({ filesystem, print: {} } as never);

  beforeEach(() => {
    app = realpathSync(mkdtempSync(join(tmpdir(), 'lt-frontend-env-')));
  });
  afterEach(() => rmSync(app, { force: true, recursive: true }));

  test('gives an Angular app its project-specific NG_PUBLIC_STORAGE_PREFIX', () => {
    writeFileSync(join(app, '.env.example'), 'NG_PUBLIC_API_URL=http://localhost:3000\nNG_PUBLIC_STORAGE_PREFIX=app-local\n');
    helper.patchFrontendEnv(app, 'shop');
    const env = readFileSync(join(app, '.env'), 'utf8');
    expect(env).toContain('NG_PUBLIC_STORAGE_PREFIX=shop-local\n');
    expect(env).toContain('NG_PUBLIC_API_URL=http://localhost:3000\n');
  });

  test('leaves a Nuxt template line untouched: nothing reads NUXT_PUBLIC_STORAGE_PREFIX', () => {
    writeFileSync(join(app, '.env'), 'NUXT_PUBLIC_SITE_URL=http://localhost:3001\nNUXT_PUBLIC_STORAGE_PREFIX=base-nuxt-local\n');
    helper.patchFrontendEnv(app, 'shop');
    expect(readFileSync(join(app, '.env'), 'utf8')).toBe(
      'NUXT_PUBLIC_SITE_URL=http://localhost:3001\nNUXT_PUBLIC_STORAGE_PREFIX=base-nuxt-local\n',
    );
  });
});
