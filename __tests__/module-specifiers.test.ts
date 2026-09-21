import { readFileSync } from 'fs';
import { join } from 'path';

import {
  fileImportedSpecifiers,
  importedSpecifiers,
  isPackageImport,
  isRelativeCoreImport,
} from '../src/lib/module-specifiers';

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
};

describe('importedSpecifiers', () => {
  it('finds every form a stale import can take', () => {
    const source = [
      "import { A } from '@lenne.tech/nest-server';",
      "import 'side-effect-only';",
      "import type { T } from './types';",
      "export { B } from '../core/b';",
      "export * from '@lenne.tech/nest-server/dist/x';",
      "import legacy = require('legacy-pkg');",
      "const lazy = await import('./lazy');",
      "const cjs = require('node:fs');",
    ].join('\n');

    expect(importedSpecifiers(source)).toEqual([
      '@lenne.tech/nest-server',
      'side-effect-only',
      './types',
      '../core/b',
      '@lenne.tech/nest-server/dist/x',
      'legacy-pkg',
      './lazy',
      'node:fs',
    ]);
  });

  it('never reports a specifier that only appears in prose', () => {
    // The incident this whole detector chain exists for: nest-server-starter's
    // bootstrap-diagnostics.spec.ts documents the conversion by quoting its syntax.
    const source = [
      '/**',
      " * The CLI rewrites `from '@lenne.tech/nest-server'` to a relative `./core` path.",
      ' */',
      "// import { X } from '@lenne.tech/nest-server';",
      "import { Real } from './real';",
      "const path = 'node_modules/@lenne.tech/nest-server/dist/x';",
    ].join('\n');

    expect(importedSpecifiers(source)).toEqual(['./real']);
  });

  it('still ignores prose BELOW a template literal — where the old approach gave up', () => {
    // This exact shape is why the predecessor was retired. `stripComments` blanked
    // comments with a bare `ts.createScanner` loop, which desynchronises on the first
    // template literal WITH a substitution (it returns TemplateHead and needs
    // reScanTemplateToken to continue) — so every comment BELOW line 1 survived and a
    // text search saw the quoted import again. Bisected on check.mjs: the regex on
    // line 63 and the division on line 66 are fine, line 67's `${s.toFixed(1)}s` is not.
    // Degraded 23 of 76 real frontend and 21 of 50 backend files.
    const source = [
      'const seconds = `${ms / 1000}s`;',
      '/**',
      " * Rewrites `from '@lenne.tech/nest-server'` to `./core`.",
      ' */',
      "import { Real } from './real';",
    ].join('\n');

    // The parser has no such state to lose.
    expect(importedSpecifiers(source)).toEqual(['./real']);
  });

  it('survives a file it cannot fully parse instead of throwing', () => {
    expect(importedSpecifiers("import { A } from './a';\nthis is not valid code (((")).toContain('./a');
  });
});

describe('fileImportedSpecifiers', () => {
  it('reads the script blocks of a Vue SFC, not its template', () => {
    // An SFC is not valid TypeScript as a whole, so the blocks are parsed individually.
    const sfc = [
      '<template>',
      '  <!-- import { Fake } from "@lenne.tech/nuxt-extensions" -->',
      '  <div>{{ msg }}</div>',
      '</template>',
      '',
      '<script setup lang="ts">',
      "import { useThing } from '@lenne.tech/nuxt-extensions';",
      '</script>',
      '',
      '<style scoped>.a { color: red }</style>',
    ].join('\n');
    const path = '/tmp/Comp.vue';

    expect(fileImportedSpecifiers(path, (p) => (p === path ? sfc : undefined))).toEqual([
      '@lenne.tech/nuxt-extensions',
    ]);
  });

  it('returns nothing for a file it cannot read', () => {
    expect(fileImportedSpecifiers('/nope.ts', () => undefined)).toEqual([]);
  });

  it('reads a real file from this repo', () => {
    const specifiers = fileImportedSpecifiers(join(__dirname, '..', 'src', 'lib', 'module-specifiers.ts'), read);
    expect(specifiers).toContain('typescript');
  });
});

describe('specifier predicates', () => {
  it('matches a package and its deep imports, but not a lookalike', () => {
    expect(isPackageImport('@lenne.tech/nest-server', '@lenne.tech/nest-server')).toBe(true);
    expect(isPackageImport('@lenne.tech/nest-server/dist/core/x', '@lenne.tech/nest-server')).toBe(true);
    expect(isPackageImport('@lenne.tech/nest-server-extras', '@lenne.tech/nest-server')).toBe(false);
    expect(isPackageImport('./nest-server', '@lenne.tech/nest-server')).toBe(false);
  });

  it('matches relative core paths only', () => {
    for (const yes of ['./core', '../core', '../../core/utils/x', './core/index']) {
      expect([yes, isRelativeCoreImport(yes)]).toEqual([yes, true]);
    }
    for (const no of ['@lenne.tech/nest-server/dist/core', 'core', './corelib', './my-core']) {
      expect([no, isRelativeCoreImport(no)]).toEqual([no, false]);
    }
  });
});
