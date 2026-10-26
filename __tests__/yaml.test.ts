import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { join, relative } from 'path';
import * as ts from 'typescript';

import { loadYaml } from '../src/lib/yaml';

/**
 * `loadYaml` keeps js-yaml 4's `load()` semantics on top of js-yaml 5. These are the
 * inputs where the two majors differ; the rest of the suite never feeds them in, which
 * is why the upgrade passed every other test while still changing behaviour.
 */
describe('loadYaml', () => {
  it('returns undefined for an empty source instead of throwing', () => {
    expect(loadYaml('')).toBeUndefined();
  });

  it('returns null for whitespace or comments only, as 4.x did', () => {
    expect(loadYaml('  \n\n')).toBeNull();
    // A pnpm-workspace.yaml whose every setting is commented out.
    expect(loadYaml('# allowBuilds:\n#   esbuild: true\n')).toBeNull();
  });

  it('returns null for an explicit empty document', () => {
    expect(loadYaml('---\n')).toBeNull();
    expect(loadYaml('~')).toBeNull();
  });

  it('resolves merge keys instead of keeping a literal "<<" key', () => {
    const doc = loadYaml('base: &b\n  x: 1\nderived:\n  <<: *b\n  y: 2\n');
    expect(doc).toEqual({ base: { x: 1 }, derived: { x: 1, y: 2 } });
  });

  it('keeps no/off/yes as STRINGS (YAML 1.2 core) — the allowBuilds deny logic depends on it', () => {
    expect(loadYaml('a: no\nb: off\nc: yes\nd: true\ne: false\n')).toEqual({
      a: 'no',
      b: 'off',
      c: 'yes',
      d: true,
      e: false,
    });
  });

  it('keeps a date as a string, so dumping the file back does not rewrite it', () => {
    expect(loadYaml('since: 2026-10-24\n')).toEqual({ since: '2026-10-24' });
  });

  it('throws on more than one document, as 4.x did', () => {
    expect(() => loadYaml('a: 1\n---\nb: 2\n')).toThrow('expected a single document');
  });

  it('throws on invalid YAML and on duplicate keys', () => {
    expect(() => loadYaml('a: [1,\n')).toThrow();
    expect(() => loadYaml('a: 1\na: 2\n')).toThrow('duplicated mapping key');
  });
});

/**
 * The wrapper only helps where it is used. A direct `load()` of js-yaml 5 reintroduces
 * the throw on an empty pnpm-workspace.yaml and the literal `'<<'` key, and nothing else
 * in the suite would notice. AST, not text: a comment that mentions `yaml.load(` must not
 * count, a renamed import must.
 */
describe('YAML is loaded only through loadYaml', () => {
  const srcRoot = join(__dirname, '..', 'src');
  const files = globSync('**/*.ts', { absolute: true, cwd: srcRoot, ignore: ['templates/**'], nodir: true }).filter(
    (file) => relative(srcRoot, file).split('\\').join('/') !== 'lib/yaml.ts',
  );

  function directLoads(file: string): string[] {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const hits: string[] = [];
    const namespaces = new Set<string>();
    const line = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const isJsYaml = (node: ts.Expression | undefined): boolean =>
      !!node && ts.isStringLiteralLike(node) && node.text === 'js-yaml';

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && isJsYaml(node.moduleSpecifier)) {
        const bindings = node.importClause?.namedBindings;
        if (node.importClause?.name) namespaces.add(node.importClause.name.text);
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (imported === 'load' || imported === 'loadAll') hits.push(`line ${line(element)}: imports ${imported}`);
          }
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (isJsYaml(node.arguments[0])) hits.push(`line ${line(node)}: require('js-yaml')`);
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text) &&
        (node.name.text === 'load' || node.name.text === 'loadAll')
      ) {
        hits.push(`line ${line(node)}: ${node.getText()}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return hits;
  }

  it('finds the source files at all', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no direct js-yaml load()/loadAll() call outside src/lib/yaml.ts', () => {
    const offenders = files
      .map((file) => ({ file: relative(srcRoot, file), hits: directLoads(file) }))
      .filter((entry) => entry.hits.length > 0)
      .map((entry) => `${entry.file}: ${entry.hits.join(', ')}`);
    expect(offenders).toEqual([]);
  });
});
