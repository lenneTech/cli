import { stripComments } from '../src/lib/strip-comments';

/**
 * Regression guard for the vendor/npm conversion's stale-import detectors.
 *
 * Both `findStaleImports` (backend) and `findStaleFrontendImports` (frontend) search consumer
 * files for import specifiers the codemod should have rewritten. Reading comments as code makes
 * them warn about imports that do not exist — which is exactly what happened to
 * nest-server-starter's `tests/unit/bootstrap-diagnostics.spec.ts`, whose docblock quotes the
 * rewrite it documents.
 */
describe('stripComments', () => {
  it('blanks a line comment that quotes an import specifier', () => {
    const source = "// rewrites `from '@lenne.tech/nest-server'` to './core'\nconst x = 1;";
    const result = stripComments(source);
    expect(result).not.toContain('@lenne.tech/nest-server');
    expect(result).toContain('const x = 1;');
  });

  it('blanks a JSDoc block that quotes an import specifier', () => {
    // This is the literal shape that produced the false positive.
    const source = [
      '/**',
      " * CLI's vendor conversion rewrites `from '@lenne.tech/nest-server'` to a relative",
      ' * `./core` path, so pinning the specifier here would fail every vendor-mode project.',
      ' */',
      "import { readFileSync } from 'node:fs';",
    ].join('\n');
    const result = stripComments(source);
    expect(result).not.toContain('@lenne.tech/nest-server');
    expect(result).toContain("import { readFileSync } from 'node:fs';");
  });

  it('keeps a REAL import untouched', () => {
    const source = "import { CoreModule } from '@lenne.tech/nest-server';";
    expect(stripComments(source)).toBe(source);
  });

  it('keeps `//` inside a string literal — it is not a comment', () => {
    // A hand-rolled regex stripper truncates the URL here and can corrupt the following code.
    const source = "const url = 'https://example.com/a//b';\nimport x from 'pkg';";
    const result = stripComments(source);
    expect(result).toContain("'https://example.com/a//b'");
    expect(result).toContain("import x from 'pkg';");
  });

  it('keeps comment-like text inside a template literal', () => {
    const source = 'const t = `/* not a comment */ still here`;';
    expect(stripComments(source)).toBe(source);
  });

  it('preserves line numbers so a caller can still report a position', () => {
    const source = ['// one', '/* two', '   three */', 'const x = 1;'].join('\n');
    expect(stripComments(source).split('\n')).toHaveLength(4);
    expect(stripComments(source).split('\n')[3]).toBe('const x = 1;');
  });
});
