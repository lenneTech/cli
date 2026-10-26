/**
 * The CommonJS forms an ES module cannot keep, taken from what nest-server-starter actually
 * contains (`src/main.ts`, `src/config.env.ts`, `tests/modules/file-rest.e2e-spec.ts`).
 */
import { Project } from 'ts-morph';

import { convertCommonJsSyntax } from '../src/lib/esm-commonjs-syntax';

const file = (text: string) => new Project({ useInMemoryFileSystem: true }).createSourceFile('/app/src/x.ts', text);

describe('convertCommonJsSyntax', () => {
  it('turns import = require into a default import, with the JSON attribute for JSON', () => {
    const source = file(
      [
        "import compression = require('compression');",
        "import packageJson = require('../package.json');",
        "import GraphQLUpload = require('graphql-upload/GraphQLUpload.js');",
        '',
      ].join('\n'),
    );

    const result = convertCommonJsSyntax(source);

    expect(source.getFullText()).toBe(
      [
        "import compression from 'compression';",
        "import packageJson from '../package.json' with { type: 'json' };",
        "import GraphQLUpload from 'graphql-upload/GraphQLUpload.js';",
        '',
      ].join('\n'),
    );
    expect(result.changed).toHaveLength(3);
    expect(result.reported).toEqual([]);
  });

  it('adds the attribute to an existing JSON default import, and reports a named one', () => {
    const source = file("import meta from './meta.json';\nimport { version } from '../package.json';\n");

    const result = convertCommonJsSyntax(source);

    expect(source.getFullText()).toContain("import meta from './meta.json' with { type: 'json' };");
    expect(result.reported).toEqual([
      expect.objectContaining({ line: 2, why: expect.stringContaining('default export only') }),
    ]);
  });

  it('replaces free __dirname / __filename, never a property or a key of the same name', () => {
    const source = file(
      [
        "const assets = join(__dirname, '..', 'public');",
        'const here = __filename;',
        'const info = { __dirname: 1 };',
        'const other = info.__dirname;',
        '',
      ].join('\n'),
    );

    convertCommonJsSyntax(source);

    expect(source.getFullText()).toBe(
      [
        "const assets = join(import.meta.dirname, '..', 'public');",
        'const here = import.meta.filename;',
        'const info = { __dirname: 1 };',
        'const other = info.__dirname;',
        '',
      ].join('\n'),
    );
  });

  it('never mistakes an identifier named like an Object.prototype member for one to replace', () => {
    // `name in {…}` matched `toString` / `constructor` through the prototype chain and crashed
    // the conversion of a real project mid-way (review, 2026-10-26).
    const text = [
      'type ObjectId = { toString(): string; valueOf(): number };',
      'function make(constructor: unknown) { return constructor; }',
      'const id = { toString: () => "x" }.toString();',
      '',
    ].join('\n');
    const source = file(text);

    expect(convertCommonJsSyntax(source).changed).toEqual([]);
    expect(source.getFullText()).toBe(text);
  });

  it('leaves a file alone that already defines its own __dirname', () => {
    const text = [
      "import { fileURLToPath } from 'node:url';",
      'const __dirname = dirname(fileURLToPath(import.meta.url));',
      "const p = join(__dirname, 'x');",
      '',
    ].join('\n');
    const source = file(text);

    expect(convertCommonJsSyntax(source).changed).toEqual([]);
    expect(source.getFullText()).toBe(text);
  });

  it('reports require, require.resolve and CommonJS exports with their line', () => {
    const source = file(
      [
        "const fs = require('fs');",
        "const where = require.resolve('x');",
        'module.exports = { a: 1 };',
        'exports.b = 2;',
        '',
      ].join('\n'),
    );

    const lines = convertCommonJsSyntax(source).reported.map((finding) => finding.line);

    expect(lines).toEqual([1, 2, 3, 4]);
  });

  it('accepts require from createRequire, the ESM way to load synchronously', () => {
    const source = file(
      [
        "import { createRequire } from 'node:module';",
        'const require = createRequire(import.meta.url);',
        "const config = require('../src/config.env');",
        '',
      ].join('\n'),
    );

    expect(convertCommonJsSyntax(source).reported).toEqual([]);
  });
});
