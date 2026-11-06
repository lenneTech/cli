import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { applyAngularSiteIdentity } from '../src/lib/angular-site-identity';

/** The two lines exactly as ng-base-starter 22.0.1 ships them (its site-contract test pins them). */
const STARTER_SITE = [
  "export const SITE_NAME = 'Angular Base Starter';",
  "export const SITE_REPO_URL: null | string = 'https://github.com/lenneTech/ng-base-starter';",
  '',
].join('\n');

describe('applyAngularSiteIdentity', () => {
  let app: string;
  beforeEach(() => {
    app = mkdtempSync(join(tmpdir(), 'lt-ng-site-'));
    mkdirSync(join(app, 'src', 'app', 'shared'), { recursive: true });
  });
  afterEach(() => {
    rmSync(app, { force: true, recursive: true });
  });

  const site = () => join(app, 'src', 'app', 'shared', 'site.ts');
  const index = () => join(app, 'src', 'index.html');

  test('names the project and drops the starter repository link', () => {
    writeFileSync(site(), STARTER_SITE);
    writeFileSync(index(), '<head>\n  <title>Angular Base Starter</title>\n</head>\n');
    expect(applyAngularSiteIdentity(app, 'shop')).toBe('changed');
    expect(readFileSync(site(), 'utf8')).toBe(
      "export const SITE_NAME = 'shop';\nexport const SITE_REPO_URL: null | string = null;\n",
    );
    expect(readFileSync(index(), 'utf8')).toContain('<title>shop</title>');
  });

  test('quotes the name for TypeScript and escapes it for HTML', () => {
    writeFileSync(site(), STARTER_SITE);
    writeFileSync(index(), '<title>Angular Base Starter</title>\n');
    applyAngularSiteIdentity(app, "Kai's <Shop>");
    // oxfmt's form: double quotes for a single quote, so a read-only `check --no-fix` passes.
    expect(readFileSync(site(), 'utf8')).toContain(`export const SITE_NAME = "Kai's <Shop>";`);
    expect(readFileSync(index(), 'utf8')).toBe("<title>Kai's &lt;Shop&gt;</title>\n");
  });

  test('a name with both quote kinds stays single-quoted and escaped', () => {
    writeFileSync(site(), STARTER_SITE);
    applyAngularSiteIdentity(app, `a'b"c\\d`);
    expect(readFileSync(site(), 'utf8')).toContain(`export const SITE_NAME = 'a\\'b"c\\\\d';`);
  });

  test('a site.ts the formatter already double-quoted is still recognised', () => {
    writeFileSync(site(), STARTER_SITE.replace("'Angular Base Starter'", '"Angular Base Starter"'));
    writeFileSync(index(), '<title>Angular Base Starter</title>\n');
    expect(applyAngularSiteIdentity(app, 'shop')).toBe('changed');
    expect(readFileSync(index(), 'utf8')).toBe('<title>shop</title>\n');
  });

  test('a title the project already changed is left alone', () => {
    writeFileSync(site(), STARTER_SITE);
    writeFileSync(index(), '<title>Something else</title>\n');
    applyAngularSiteIdentity(app, 'shop');
    expect(readFileSync(index(), 'utf8')).toBe('<title>Something else</title>\n');
  });

  test('is idempotent', () => {
    writeFileSync(site(), STARTER_SITE);
    applyAngularSiteIdentity(app, 'shop');
    expect(applyAngularSiteIdentity(app, 'shop')).toBe('unchanged');
  });

  test('an older starter without site.ts, or one in another shape, is not touched', () => {
    expect(applyAngularSiteIdentity(app, 'shop')).toBe('missing');
    const other = "export const SITE_NAME = `Angular Base Starter`;\n";
    writeFileSync(site(), other);
    expect(applyAngularSiteIdentity(app, 'shop')).toBe('unrecognised');
    expect(readFileSync(site(), 'utf8')).toBe(other);
  });

  test('never writes through a symlinked site.ts', () => {
    const outside = join(app, 'outside.ts');
    writeFileSync(outside, STARTER_SITE);
    symlinkSync(outside, site());
    expect(applyAngularSiteIdentity(app, 'shop')).toBe('missing');
    expect(readFileSync(outside, 'utf8')).toBe(STARTER_SITE);
  });
});
