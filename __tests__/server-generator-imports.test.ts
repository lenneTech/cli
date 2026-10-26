/**
 * `lt server module` / `lt server object` emit extra imports for special property
 * types (JSON, FileInfo/File/Upload) from `Server#imports`, a table written in
 * npm-mode form. Two defects made every such property fail `tsc`:
 *
 * - In a vendored project the lines kept `from '@lenne.tech/nest-server'`, a package
 *   that is not installed there (TS2307). Vendor mode is the default of
 *   `lt fullstack init`.
 * - `mapClasses(input, { attachment: FileInfo }, this)` named the raw property type,
 *   while the class the model declares and imports is `CoreFileInfo` (TS2304).
 *
 * Found by generating a module with these property types in a freshly vendored
 * project (2026-10-24); the integration script only generates string/number props.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { filesystem, strings } from 'gluegun';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { ServerProps } from '../src/interfaces/ServerProps.interface';
import { Server } from '../src/extensions/server';
import { withFrameworkImportSpecifier } from '../src/lib/framework-detection';

const server = new Server({
  filesystem,
  print: { info: () => undefined },
  prompt: { ask: async () => ({}), confirm: async () => true },
  strings,
} as any);

const prop = (name: string, type: string): ServerProps => ({ isArray: false, name, nullable: false, type });

describe('withFrameworkImportSpecifier', () => {
  it('points every framework import at the given specifier', () => {
    const lines = server.propsForModel({
      attachment: prop('attachment', 'FileInfo'),
      meta: prop('meta', 'JSON'),
    }).imports;
    expect(lines).toContain("from '@lenne.tech/nest-server';");

    const rewritten = withFrameworkImportSpecifier(lines, '../../../core');
    expect(rewritten).not.toContain('@lenne.tech/nest-server');
    expect(rewritten).toContain("import { CoreFileInfo } from '../../../core';");
    expect(rewritten).toContain("import { JSON } from '../../../core';");
  });

  it('leaves other packages alone and is a no-op for the npm-mode specifier', () => {
    const lines = [
      "import { JSON } from '@lenne.tech/nest-server';",
      "import type { FileUpload } from 'graphql-upload/processRequest.js';",
    ].join('\n');

    expect(withFrameworkImportSpecifier(lines, '@lenne.tech/nest-server')).toBe(lines);
    expect(withFrameworkImportSpecifier(lines, '../core')).toContain(
      "import type { FileUpload } from 'graphql-upload/processRequest.js';",
    );
  });
});

describe('propsForModel mappings', () => {
  it.each(['FileInfo', 'File', 'Upload'])('maps a %s property to the imported CoreFileInfo class', (type) => {
    const { imports, mappings } = server.propsForModel({ attachment: prop('attachment', type) });

    expect(mappings).toBe('mapClasses(input, { attachment: CoreFileInfo }, this);');
    expect(imports).toContain('CoreFileInfo');
  });

  it('keeps mapping a sub-object schema to its own class', () => {
    const item: ServerProps = { ...prop('address', 'Address'), schema: 'Address' };

    expect(server.propsForModel({ address: item }).mappings).toBe('mapClasses(input, { address: Address }, this);');
  });

  it('does not map primitives or JSON', () => {
    const { mappings } = server.propsForModel({ meta: prop('meta', 'JSON'), name: prop('name', 'string') });

    expect(mappings).toBe('this;');
  });
});

/**
 * The CLI serves nest-server 11.x and 12.x projects. Only 12 exports the `GraphQLUpload`
 * scalar from its root; for 11 the import-equals form is the one that stays a plain
 * `require()` under TypeScript 5 and 6 (`import * as` turned into an `__importStar` copy
 * under TypeScript 6 and failed the GraphQL boot). Decided by the framework's files, so the
 * four layouts below are the whole matrix.
 */
describe('GraphQLUpload import per framework version and mode', () => {
  let dir: string;

  const serverIn = (cwd: string): Server =>
    new Server({
      filesystem: { ...filesystem, cwd: () => cwd },
      print: { info: () => undefined },
      prompt: { ask: async () => ({}), confirm: async () => true },
      strings,
    } as any);
  const touch = (path: string, content = ''): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-upload-import-'));
    touch(join(dir, 'package.json'), '{"name":"api"}');
  });
  afterEach(() => rmSync(dir, { force: true, recursive: true }));

  const NS12 = "import { GraphQLUpload } from '@lenne.tech/nest-server';";
  const NS11 = "import GraphQLUpload = require('graphql-upload/GraphQLUpload.js');";

  it('npm mode, nest-server 12: root export', () => {
    touch(join(dir, 'node_modules/@lenne.tech/nest-server/dist/core/common/scalars/upload.scalar.js'));
    expect(serverIn(dir).importLine('GraphQLUpload')).toBe(NS12);
  });

  it('npm mode, nest-server 11: import-equals', () => {
    touch(join(dir, 'node_modules/@lenne.tech/nest-server/dist/core/common/scalars/json.scalar.js'));
    expect(serverIn(dir).importLine('GraphQLUpload')).toBe(NS11);
  });

  it('vendor mode, core 12: root export (rewritten to the relative core by the caller)', () => {
    touch(join(dir, 'src/core/VENDOR.md'), '# @lenne.tech/nest-server – core (vendored)');
    touch(join(dir, 'src/core/common/scalars/upload.scalar.ts'));
    expect(serverIn(join(dir, 'src')).importLine('GraphQLUpload')).toBe(NS12);
  });

  it('vendor mode, core 11: import-equals', () => {
    touch(join(dir, 'src/core/VENDOR.md'), '# @lenne.tech/nest-server – core (vendored)');
    touch(join(dir, 'src/core/common/scalars/json.scalar.ts'));
    expect(serverIn(join(dir, 'src')).importLine('GraphQLUpload')).toBe(NS11);
  });

  it('a file property input uses the Upload scalar, its model keeps CoreFileInfo', () => {
    touch(join(dir, 'node_modules/@lenne.tech/nest-server/dist/core/common/scalars/upload.scalar.js'));
    const gen = serverIn(dir);
    const input = gen.propsForInput({ attachment: prop('attachment', 'FileInfo') }, { modelName: 'Doc' });
    const model = gen.propsForModel({ attachment: prop('attachment', 'FileInfo') }, { modelName: 'Doc' });

    expect(input.props).toContain('type: () => GraphQLUpload');
    expect(input.imports).toContain(NS12);
    expect(model.props).toContain('type: () => CoreFileInfo');
    expect(model.imports).not.toContain('GraphQLUpload');
  });
});
