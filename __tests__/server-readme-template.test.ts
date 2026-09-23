import { render } from 'ejs';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The README `lt server create` writes into every standalone API project.
 *
 * It used to describe linking the framework via yalc and `npm run watch`, a way
 * nest-server-starter dropped long ago. In vendor mode the section was not
 * merely stale but meaningless: there is no `@lenne.tech/nest-server` package to
 * link, the core lives in `src/core/`. The npm variant names only the starter's
 * script names, which are stable, and never their implementation, which is not.
 */
describe('nest-server-starter README template', () => {
  const template = readFileSync(join(__dirname, '..', 'src/templates/nest-server-starter/README.md.ejs'), 'utf-8');
  const readme = (vendor: boolean) => render(template, { props: { description: 'd', name: 'demo', vendor } });

  it('npm mode: links through the starter scripts, no yalc', () => {
    const out = readme(false);
    expect(out).toContain('pnpm run link:nest-server');
    expect(out).toContain('pnpm run unlink:nest-server');
    expect(out).not.toMatch(/yalc|npm run watch/);
    expect(out).not.toContain('VENDOR.md');
  });

  it('vendor mode: points at src/core/ and VENDOR.md, offers nothing to link', () => {
    const out = readme(true);
    expect(out).toContain('src/core/VENDOR.md');
    expect(out).not.toMatch(/link:nest-server|yalc|npm run watch/);
  });

  it('setupServer passes the framework mode into the template', () => {
    const source = readFileSync(join(__dirname, '..', 'src/extensions/server.ts'), 'utf-8');
    const call = source.slice(source.lastIndexOf('template.generate(', source.indexOf("'nest-server-starter/README.md.ejs'")));
    expect(call.slice(0, call.indexOf('});'))).toMatch(/vendor:\s*frameworkMode === 'vendor'/);
  });
});
