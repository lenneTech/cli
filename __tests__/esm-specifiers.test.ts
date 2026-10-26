/**
 * Node's ESM resolver does not complete a relative specifier, so an ES module project names the
 * emitted file: `./x.js`, `./dir/index.js` (nest-server migration guide 11.43.x → 12.0.x, §17).
 */
import { Project } from 'ts-morph';

import { addJsExtensions, resolveRuntimeSpecifier } from '../src/lib/esm-specifiers';

function project(files: Record<string, string>) {
  const p = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(files)) p.createSourceFile(path, text);
  p.saveSync(); // in-memory files reach the file system only on save
  const fs = p.getFileSystem();
  return { exists: (path: string) => fs.fileExistsSync(path), p };
}

describe('addJsExtensions', () => {
  it('names the emitted file for imports, re-exports, import() and import types, keeping the quotes', () => {
    const { exists, p } = project({
      '/app/src/a.ts': [
        "import { B } from './b';",
        'import type { C } from "./c";',
        "export * from './dir';",
        "export { D } from '../top';",
        "const lazy = () => import('./b');",
        "type T = import('./c').C;",
        '',
      ].join('\n'),
      '/app/src/b.ts': 'export const B = 1;',
      '/app/src/c.ts': 'export interface C {}',
      '/app/src/dir/index.ts': 'export const E = 1;',
      '/app/top.ts': 'export const D = 1;',
    });
    const source = p.getSourceFileOrThrow('/app/src/a.ts');

    const result = addJsExtensions(source, exists);

    expect(source.getFullText()).toBe(
      [
        "import { B } from './b.js';",
        'import type { C } from "./c.js";',
        "export * from './dir/index.js';",
        "export { D } from '../top.js';",
        "const lazy = () => import('./b.js');",
        "type T = import('./c.js').C;",
        '',
      ].join('\n'),
    );
    expect(result.changed).toHaveLength(6);
    expect(result.unresolved).toEqual([]);
  });

  it('leaves package imports and specifiers that already name a runtime file alone, and is idempotent', () => {
    const text = [
      "import { Injectable } from '@nestjs/common';",
      "import meta from './meta.json' with { type: 'json' };",
      "import { x } from './x.js';",
      "import { y } from './y.cjs';",
      '',
    ].join('\n');
    const { exists, p } = project({ '/app/a.ts': text, '/app/x.ts': '', '/app/y.cts': '' });
    const source = p.getSourceFileOrThrow('/app/a.ts');

    expect(addJsExtensions(source, exists)).toEqual({ changed: [], unresolved: [] });
    expect(source.getFullText()).toBe(text);
  });

  it('maps .mts and .cts sources to the extension Node loads', () => {
    const { exists, p } = project({
      '/app/a.ts': "import { m } from './m';\nimport { c } from './c';\n",
      '/app/c.cts': 'export const c = 1;',
      '/app/m.mts': 'export const m = 1;',
    });
    const source = p.getSourceFileOrThrow('/app/a.ts');
    addJsExtensions(source, exists);
    expect(source.getFullText()).toContain("from './m.mjs'");
    expect(source.getFullText()).toContain("from './c.cjs'");
  });

  it('reports a specifier that resolves to nothing instead of guessing an extension', () => {
    const { exists, p } = project({ '/app/a.ts': "import { gone } from './gone';\n" });
    const source = p.getSourceFileOrThrow('/app/a.ts');

    expect(addJsExtensions(source, exists)).toEqual({ changed: [], unresolved: [{ line: 1, specifier: './gone' }] });
    expect(source.getFullText()).toContain("from './gone'");
  });
});

describe('resolveRuntimeSpecifier', () => {
  it('prefers a file over a directory of the same name, as TypeScript does', () => {
    const files = new Set(['/app/user.ts', '/app/user/index.ts']);
    expect(resolveRuntimeSpecifier('/app', './user', (path) => files.has(path))).toBe('./user.js');
  });

  it('resolves the framework root of a vendored core to its index file', () => {
    const files = new Set(['/app/src/core/index.ts']);
    expect(resolveRuntimeSpecifier('/app/src/server/modules/user', '../../../core', (path) => files.has(path))).toBe(
      '../../../core/index.js',
    );
  });

  it('resolves Windows paths on any host: ts-morph reports C:/…, path.join C:\\…', () => {
    // path.resolve on Windows turned ts-morph's `C:/app/src` into `C:\app\src\b.ts`, which the
    // in-memory file system never has, so nothing resolved there (windows-latest, 1.52.0).
    const files = new Set(['C:/app/src/b.ts', 'C:/app/top.ts', 'C:/app/core/index.ts']);
    const exists = (path: string) => files.has(path);
    expect(resolveRuntimeSpecifier('C:/app/src', './b', exists)).toBe('./b.js');
    expect(resolveRuntimeSpecifier('C:\\app\\src', '../top', exists)).toBe('../top.js');
    expect(resolveRuntimeSpecifier('C:\\app\\src', '../core', exists)).toBe('../core/index.js');
  });
});
