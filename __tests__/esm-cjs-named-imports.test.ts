/**
 * `import { cloneDeep } from 'lodash'` type-checks and passes vitest, and fails at start-up in
 * Node's ESM loader. The check asks Node itself; measured with this repo's own lodash, whose ESM
 * namespace has no `cloneDeep`.
 */
import { join } from 'path';
import { Project, ts } from 'ts-morph';

import {
  checkNamedImportsAgainstNode,
  collectEmittedNamedImports,
  namedPackageImports,
} from '../src/lib/esm-cjs-named-imports';

describe('namedPackageImports', () => {
  it('lists the named imports of packages, never relative ones or default/namespace imports', () => {
    expect(
      namedPackageImports(
        [
          "import { cloneDeep, map as m } from 'lodash';",
          "import mongoose from 'mongoose';",
          "import * as fs from 'node:fs';",
          "import { x } from './x.js';",
        ].join('\n'),
      ),
    ).toEqual([
      { name: 'cloneDeep', specifier: 'lodash' },
      { name: 'map', specifier: 'lodash' },
    ]);
  });
});

describe('collectEmittedNamedImports', () => {
  it('ignores a named import TypeScript erases because it is only a type', () => {
    const project = new Project({
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
      useInMemoryFileSystem: true,
    });
    project.createSourceFile(
      '/app/a.ts',
      [
        "import { Connection, Schema } from 'mongoose';",
        'export let c: Connection;',
        'export const s = new Schema({});',
        '',
      ].join('\n'),
    );

    expect(collectEmittedNamedImports(project, () => true)).toEqual([
      { file: '/app/a.ts', line: 1, name: 'Schema', specifier: 'mongoose' },
    ]);
  });
});

describe('checkNamedImportsAgainstNode', () => {
  it("reports what Node's real ESM view of a CommonJS package lacks (this repo's lodash)", () => {
    const findings = checkNamedImportsAgainstNode(join(__dirname, '..'), [
      { file: '/app/a.ts', line: 3, name: 'cloneDeep', specifier: 'lodash' },
      { file: '/app/a.ts', line: 4, name: 'readFileSync', specifier: 'node:fs' },
    ]);

    expect(findings).toEqual([
      expect.objectContaining({ line: 3, name: 'cloneDeep', why: expect.stringContaining('no named export') }),
    ]);
  });

  it('reports a package Node cannot import once, with its error code', () => {
    const findings = checkNamedImportsAgainstNode(
      '/app',
      [
        { file: '/app/a.ts', line: 1, name: 'a', specifier: 'gone' },
        { file: '/app/b.ts', line: 2, name: 'b', specifier: 'gone' },
      ],
      () => ({ gone: { error: 'ERR_MODULE_NOT_FOUND' } }),
    );

    expect(findings).toEqual([expect.objectContaining({ specifier: 'gone', why: expect.stringContaining('ERR_MODULE_NOT_FOUND') })]);
  });
});
