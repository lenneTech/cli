/**
 * The project's own code that a mode conversion rewrites, and that the
 * stale-import check scans afterwards. nest-server-starter 12.4.0 added
 * `src/config.env.spec.ts`, which imports from `@lenne.tech/nest-server`; the
 * file lists named only `src/main.ts` and `src/config.env.ts` from the `src/`
 * root, so every new vendor project failed `typecheck:tests` with TS2307 and
 * the check meant to catch a missed import said nothing.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { globSync } from 'glob';
import { filesystem, strings } from 'gluegun';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { Server } from '../src/extensions/server';
import { isPackageImport } from '../src/lib/module-specifiers';
import { CONSUMER_SOURCE_GLOBS, rewriteFrameworkImportsToCore } from '../src/lib/vendor-consumer-imports';

const server = new Server({
  filesystem,
  print: { info: () => undefined },
  prompt: { ask: async () => ({}), confirm: async () => true },
  strings,
} as any);

/** The import block of nest-server-starter 12.5.0's `src/config.env.spec.ts`. */
const CONFIG_ENV_SPEC = `import { mkdtempSync, rmSync } from 'node:fs';

import {
  FRAMEWORK_SECRET_FIELDS,
  type IServerOptions,
  isConfigEndpointEnabled,
  redactSecrets,
  resolveSystemSetupHttpInit,
} from '@lenne.tech/nest-server';
import { describe, expect, it } from 'vitest';

describe('config', () => {
  it('works', () => expect([FRAMEWORK_SECRET_FIELDS, isConfigEndpointEnabled, redactSecrets, resolveSystemSetupHttpInit, mkdtempSync, rmSync]).toBeDefined());
});
const options: IServerOptions = {};
`;

const FILES: Record<string, string> = {
  'migrations-utils/template.ts': "const { getDb } = require('@lenne.tech/nest-server');\nexport { getDb };\n",
  'src/config.env.spec.ts': CONFIG_ENV_SPEC,
  'src/config.env.ts': "import { IServerOptions } from '@lenne.tech/nest-server';\nexport const config: IServerOptions = {};\n",
  // The framework itself: never a consumer, whatever it contains.
  'src/core/index.ts': "export const marker = require('@lenne.tech/nest-server');\n",
  'src/main.ts': "import { CoreModule } from '@lenne.tech/nest-server';\nexport { CoreModule };\n",
  'src/server/modules/user/user.service.ts': "export { CrudService } from '@lenne.tech/nest-server';\n",
  'tests/project.e2e-spec.ts': "export const load = () => import('@lenne.tech/nest-server');\n",
};

describe('project code of a mode conversion', () => {
  let dest: string;
  const read = (file: string): string => readFileSync(join(dest, file), 'utf8');

  beforeEach(() => {
    dest = mkdtempSync(join(tmpdir(), 'lt-consumer-imports-'));
    for (const [file, content] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dest, file)), { recursive: true });
      writeFileSync(join(dest, file), content);
    }
  });

  afterEach(() => rmSync(dest, { force: true, recursive: true }));

  test('the vendor codemod rewrites src/config.env.spec.ts to the vendored core', () => {
    rewriteFrameworkImportsToCore({ coreDir: join(dest, 'src/core'), dest });

    const spec = read('src/config.env.spec.ts');
    expect(spec).toContain("} from './core';");
    expect(spec).not.toContain('@lenne.tech/nest-server');
    // Only the specifier moves: names, `type` modifiers and the other imports stay.
    expect(spec).toContain('  type IServerOptions,\n');
    expect(spec).toContain("import { mkdtempSync, rmSync } from 'node:fs';");
  });

  test('every project file gets a path relative to its own location, the core none', () => {
    const rewritten = rewriteFrameworkImportsToCore({ coreDir: join(dest, 'src/core'), dest });

    expect(read('src/main.ts')).toContain("from './core';");
    expect(read('src/config.env.ts')).toContain("from './core';");
    expect(read('src/server/modules/user/user.service.ts')).toContain("from '../../../core';");
    expect(read('tests/project.e2e-spec.ts')).toContain("import('../src/core')");
    expect(read('migrations-utils/template.ts')).toContain("require('../src/core')");
    expect(read('src/core/index.ts')).toBe(FILES['src/core/index.ts']);
    expect(rewritten).toHaveLength(6);
  });

  test('a second run changes nothing', () => {
    rewriteFrameworkImportsToCore({ coreDir: join(dest, 'src/core'), dest });
    const after = Object.keys(FILES).map(read);

    expect(rewriteFrameworkImportsToCore({ coreDir: join(dest, 'src/core'), dest })).toEqual([]);
    expect(Object.keys(FILES).map(read)).toEqual(after);
  });

  test('the stale-import check sees a src/ root spec the conversion missed', () => {
    const stale = (server as any).findStaleImports(dest, (specifier: string) =>
      isPackageImport(specifier, '@lenne.tech/nest-server'),
    );

    expect(stale).toContain('src/config.env.spec.ts');
    expect(stale).not.toContain('src/core/index.ts');
  });

  test('the stale-import check is quiet after the conversion', () => {
    rewriteFrameworkImportsToCore({ coreDir: join(dest, 'src/core'), dest });

    expect(
      (server as any).findStaleImports(dest, (specifier: string) =>
        isPackageImport(specifier, '@lenne.tech/nest-server'),
      ),
    ).toEqual([]);
  });

  test('no pattern reaches into the vendored core', () => {
    const matched = CONSUMER_SOURCE_GLOBS.flatMap((glob) => globSync(glob, { cwd: dest, nodir: true }));

    expect(matched.map((file) => file.split('\\').join('/')).sort()).toEqual(
      Object.keys(FILES)
        .filter((file) => !file.startsWith('src/core/'))
        .sort(),
    );
  });
});
