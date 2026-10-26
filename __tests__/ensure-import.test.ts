/**
 * `lt server addProp` adds properties to files that already exist, so the imports a new JSON
 * or file property needs have to be merged into them. Before, it added none: every such
 * property left the project failing `tsc` with TS2304.
 */
import { Project } from 'ts-morph';

import { ensureImportLine, sameModule } from '../src/lib/ensure-import';

const file = (text: string) => new Project({ useInMemoryFileSystem: true }).createSourceFile('doc.model.ts', text);

const MODEL = [
  "import { Restricted, UnifiedField } from '../../../core';",
  "import { Schema } from 'mongoose';",
  '',
  'export class Doc {}',
  '',
].join('\n');

describe('ensureImportLine', () => {
  it('merges a named import into the existing declaration of the same module', () => {
    const source = file(MODEL);

    expect(ensureImportLine(source, "import { JSON } from '../../../core';")).toBe(true);

    expect(source.getFullText()).toContain("import { Restricted, UnifiedField, JSON } from '../../../core';");
    expect(source.getImportDeclarations()).toHaveLength(2);
  });

  it('adds a new declaration for a module the file does not import yet', () => {
    const source = file(MODEL);

    ensureImportLine(source, "import type { FileUpload } from 'graphql-upload/processRequest.js';");

    expect(source.getFullText()).toContain("import type { FileUpload } from 'graphql-upload/processRequest.js';");
  });

  it('keeps a type-only import apart from a value import of the same module', () => {
    const source = file("import { Upload } from 'graphql-upload/processRequest.js';\n");

    ensureImportLine(source, "import type { FileUpload } from 'graphql-upload/processRequest.js';");

    expect(source.getImportDeclarations().map((d) => d.isTypeOnly())).toEqual([false, true]);
  });

  it('inserts an import-equals line after the last import (nest-server 11 upload scalar)', () => {
    const source = file(MODEL);

    ensureImportLine(source, "import GraphQLUpload = require('graphql-upload/GraphQLUpload.js');");

    const lines = source.getFullText().split('\n');
    expect(lines[2]).toBe("import GraphQLUpload = require('graphql-upload/GraphQLUpload.js');");
  });

  it('is idempotent, and never adds a name the file already binds under another module', () => {
    const source = file(MODEL);
    ensureImportLine(source, "import { CoreFileInfo } from '../../../core';");
    ensureImportLine(source, "import GraphQLUpload = require('graphql-upload/GraphQLUpload.js');");
    const once = source.getFullText();

    expect(ensureImportLine(source, "import { CoreFileInfo } from '../../../core';")).toBe(false);
    expect(ensureImportLine(source, "import { GraphQLUpload } from '../../../core';")).toBe(false);
    expect(source.getFullText()).toBe(once);
  });

  it('ignores anything that is not a single named or import-equals import', () => {
    const source = file(MODEL);

    expect(ensureImportLine(source, 'const x = 1;')).toBe(false);
    expect(ensureImportLine(source, "import * as fs from 'fs';")).toBe(false);
    expect(source.getFullText()).toBe(MODEL);
  });
});

describe('ensureImportLine in an ES module project', () => {
  it('merges into the declaration that names the same module with its ESM extension', () => {
    const source = file("import { Restricted, UnifiedField } from '../../../core/index.js';\n");

    ensureImportLine(source, "import { CoreFileInfo } from '../../../core';");

    expect(source.getFullText()).toBe("import { Restricted, UnifiedField, CoreFileInfo } from '../../../core/index.js';\n");
    expect(source.getImportDeclarations()).toHaveLength(1);
  });

  it('never treats two different packages as one module', () => {
    expect(sameModule('lodash', 'lodash.js')).toBe(false);
    expect(sameModule('./x', './x.js')).toBe(true);
    expect(sameModule('./x', './y.js')).toBe(false);
  });
});
