import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { filesystem, patching } from 'gluegun';
// gluegun's own argv parser: digit-only values arrive as numbers, as in the CLI.
const { parseParams } = require('gluegun/build/toolbox/parameter-tools');
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { FrontendHelper } from '../src/extensions/frontend-helper';
import { applyAngularSiteIdentity, applyNuxtSiteIdentity } from '../src/lib/site-identity';

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

  test('a digit-only name (a number from gluegun) is written as text, title included', () => {
    writeFileSync(site(), STARTER_SITE);
    writeFileSync(index(), '<title>Angular Base Starter</title>\n');
    applyAngularSiteIdentity(app, parseParams(['fullstack', 'init', '--name', '2025']).options.name);
    expect(readFileSync(site(), 'utf8')).toContain("export const SITE_NAME = '2025';");
    expect(readFileSync(index(), 'utf8')).toBe('<title>2025</title>\n');
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

/** The two lines as nuxt-base-starter ships them in `app/utils/site.ts` (DEV-4132, its contract test pins them). */
const NUXT_STARTER_SITE = [
  "export const SITE_NAME = 'Nuxt Base Starter';",
  "export const SITE_REPO_URL: null | string = 'https://github.com/lenneTech/nuxt-base-starter';",
  '',
].join('\n');

describe('applyNuxtSiteIdentity', () => {
  let app: string;
  beforeEach(() => {
    app = mkdtempSync(join(tmpdir(), 'lt-nuxt-site-'));
    mkdirSync(join(app, 'app', 'utils'), { recursive: true });
  });
  afterEach(() => {
    rmSync(app, { force: true, recursive: true });
  });

  const site = () => join(app, 'app', 'utils', 'site.ts');

  test('names the project and drops the starter repository link', () => {
    writeFileSync(site(), NUXT_STARTER_SITE);
    expect(applyNuxtSiteIdentity(app, 'shop')).toBe('changed');
    expect(readFileSync(site(), 'utf8')).toBe(
      "export const SITE_NAME = 'shop';\nexport const SITE_REPO_URL: null | string = null;\n",
    );
  });

  test('quotes the name the way oxfmt prints it', () => {
    writeFileSync(site(), NUXT_STARTER_SITE);
    applyNuxtSiteIdentity(app, "Kai's Shop");
    expect(readFileSync(site(), 'utf8')).toContain(`export const SITE_NAME = "Kai's Shop";`);
  });

  test('a digit-only name is written as text: gluegun parses `--name 2025` as a number', () => {
    const name = parseParams(['fullstack', 'init', '--name', '2025']).options.name;
    expect(typeof name).toBe('number');
    writeFileSync(site(), NUXT_STARTER_SITE);

    expect(applyNuxtSiteIdentity(app, name)).toBe('changed');
    expect(readFileSync(site(), 'utf8')).toContain("export const SITE_NAME = '2025';");
  });

  test('an older starter without site.ts is skipped, another shape is left untouched', () => {
    expect(applyNuxtSiteIdentity(app, 'shop')).toBe('missing');
    const other = "export const SITE = { name: 'Nuxt Base Starter' };\n";
    writeFileSync(site(), other);
    expect(applyNuxtSiteIdentity(app, 'shop')).toBe('unrecognised');
    expect(readFileSync(site(), 'utf8')).toBe(other);
  });

  test('never writes through a symlinked site.ts', () => {
    const outside = join(app, 'outside.ts');
    writeFileSync(outside, NUXT_STARTER_SITE);
    symlinkSync(outside, site());
    expect(applyNuxtSiteIdentity(app, 'shop')).toBe('missing');
    expect(readFileSync(outside, 'utf8')).toBe(NUXT_STARTER_SITE);
  });
});

/**
 * `lt fullstack init`, `add-app` and `lt frontend nuxt` reach the rename through `setupNuxt`, so it
 * runs here with a stubbed template source that lays down the cloned starter as `git clone` does.
 */
describe('setupNuxt names the project (DEV-4132)', () => {
  let root: string;
  let warnings: string[];
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lt-setup-nuxt-'));
    warnings = [];
  });
  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  /** A helper whose template source lays down the cloned starter, as `git clone` does. */
  function helperFor(siteFile: null | string): FrontendHelper {
    const templateHelper = {
      setup: async (dest: string) => {
        const template = join(dest, 'nuxt-base-template');
        mkdirSync(join(template, 'app', 'utils'), { recursive: true });
        writeFileSync(join(dest, 'package.json'), '{"name":"create-nuxt-base"}\n');
        writeFileSync(join(template, 'package.json'), '{"name":"nuxt-base-template"}\n');
        if (siteFile !== null) writeFileSync(join(template, 'app', 'utils', 'site.ts'), siteFile);
        return { method: 'clone', path: dest, success: true };
      },
    };
    const print = { error: () => {}, info: () => {}, success: () => {}, warning: (m: string) => warnings.push(m) };
    return new FrontendHelper({ filesystem, patching, print, templateHelper } as never);
  }

  test('a clone gets the project name and no starter link', async () => {
    const dest = join(root, 'projects', 'app');
    const result = await helperFor(NUXT_STARTER_SITE).setupNuxt(dest, { siteName: 'shop', skipInstall: true });

    expect(result.success).toBe(true);
    expect(readFileSync(join(dest, 'app', 'utils', 'site.ts'), 'utf8')).toBe(
      "export const SITE_NAME = 'shop';\nexport const SITE_REPO_URL: null | string = null;\n",
    );
    expect(warnings).toEqual([]);
  });

  test('a starter without site.ts (older release, --next) is set up without a warning', async () => {
    const dest = join(root, 'projects', 'app');
    const result = await helperFor(null).setupNuxt(dest, { siteName: 'shop', skipInstall: true });

    expect(result.success).toBe(true);
    expect(warnings).toEqual([]);
  });

  test('a site.ts in an unknown shape stays as it is and is reported', async () => {
    const dest = join(root, 'projects', 'app');
    const other = "export const SITE = { name: 'Nuxt Base Starter' };\n";
    await helperFor(other).setupNuxt(dest, { siteName: 'shop', skipInstall: true });

    expect(readFileSync(join(dest, 'app', 'utils', 'site.ts'), 'utf8')).toBe(other);
    expect(warnings.join('\n')).toMatch(/app\/utils\/site\.ts has no SITE_NAME \/ SITE_REPO_URL lines/);
  });

  test('a linked checkout is the developer’s own and is never renamed', async () => {
    // Real link mode: projects/app is a symlink to <checkout>/nuxt-base-template, so site.ts itself is
    // a plain file reached through a linked directory, and only the link-mode guard keeps it intact.
    const checkoutSite = join(root, 'checkout', 'nuxt-base-template', 'app', 'utils', 'site.ts');
    mkdirSync(dirname(checkoutSite), { recursive: true });
    writeFileSync(checkoutSite, NUXT_STARTER_SITE);
    writeFileSync(join(root, 'checkout', 'nuxt-base-template', 'package.json'), '{"name":"nuxt-base-template"}\n');
    const dest = join(root, 'projects', 'app');
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(join(root, 'checkout', 'nuxt-base-template'), dest, 'dir');
    const templateHelper = { setup: async () => ({ method: 'link', path: dest, success: true }) };
    const print = { error: () => {}, info: () => {}, success: () => {}, warning: () => {} };
    const helper = new FrontendHelper({ filesystem, patching, print, templateHelper } as never);

    await helper.setupNuxt(dest, { linkPath: join(root, 'checkout'), siteName: 'shop', skipInstall: true });

    expect(readFileSync(checkoutSite, 'utf8')).toBe(NUXT_STARTER_SITE);
  });
});
