import { render } from 'ejs';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

import { serverTestModuleImports } from '../src/lib/server-test-imports';

/**
 * The e2e test `lt server test` writes. It used to sign users up through the GraphQL
 * `signUp` mutation and delete them through `deleteUser`, the way projects worked before
 * Better Auth. A current project has neither path, and a REST project has no GraphQL at
 * all, so the generated test failed in every project the CLI creates today. It now
 * follows nest-server-starter's `tests/project.e2e-spec.ts`: IAM REST sign-up and sign-in,
 * the TestHelper, and cleanup through the database.
 */
describe('lt server test template', () => {
  const template = readFileSync(join(__dirname, '..', 'src/templates/nest-server-tests/tests.e2e-spec.ts.ejs'), 'utf-8');
  const generate = (serverModuleSource?: string, frameworkImport = '@lenne.tech/nest-server') => {
    const moduleImports = serverTestModuleImports(serverModuleSource);
    return render(template, {
      props: {
        frameworkImport,
        nameCamel: 'myTest',
        nameKebab: 'my-test',
        namePascal: 'MyTest',
        serverModuleImports: moduleImports.importNames,
        testingModuleImports: moduleImports.modules,
      },
    });
  };
  const STARTER_SERVER_MODULE = [
    "import { Module } from '@nestjs/common';",
    'export const imports = [CoreModule.forRoot(envConfig)];',
    '@Module({ imports })',
    'export class ServerModule {}',
  ].join('\n');

  it('signs users up and in through Better Auth (IAM REST), not through GraphQL', () => {
    const out = generate(STARTER_SERVER_MODULE);
    expect(out).toContain("testHelper.rest('/iam/sign-up/email'");
    expect(out).toContain("testHelper.rest('/iam/sign-in/email'");
    expect(out).toContain('TestHelper.extractSessionToken(res)');
    expect(out).not.toMatch(/graphQl\(|TestGraphQLType|name: 'signUp'|name: 'deleteUser'/);
  });

  it('needs no GraphQL package, so it also runs in a REST project', () => {
    expect(generate(STARTER_SERVER_MODULE)).not.toMatch(/graphql-subscriptions|PubSub/);
  });

  it('boots the global modules the starter exports, and falls back where they are not exported', () => {
    const current = generate(STARTER_SERVER_MODULE);
    expect(current).toContain("import { imports, ServerModule } from '../src/server/server.module';");
    expect(current).toContain('imports: [...imports, ServerModule],');

    const older = generate("@Module({ imports: [CoreModule.forRoot(envConfig)] })\nexport class ServerModule {}\n");
    expect(older).toContain("import { ServerModule } from '../src/server/server.module';");
    expect(older).toContain('imports: [ServerModule],');
  });

  it('takes the framework specifier the generator computed (vendor mode)', () => {
    expect(generate(STARTER_SERVER_MODULE, '../src/core')).toMatch(
      /^import \{ HttpExceptionLogFilter, RoleEnum, TestHelper \} from '\.\.\/src\/core';/,
    );
  });

  it('renders syntactically valid TypeScript in both variants', () => {
    for (const out of [generate(STARTER_SERVER_MODULE), generate(undefined)]) {
      const file = ts.createSourceFile('my-test.e2e-spec.ts', out, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
      expect((file as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics).toEqual([]);
    }
  });
});

describe('serverTestModuleImports', () => {
  it('recognises `export { imports }` too', () => {
    expect(serverTestModuleImports('const imports = [];\nexport { imports };\n').importNames).toBe(
      'imports, ServerModule',
    );
  });

  it('is not fooled by a comment or by a non-exported list', () => {
    expect(serverTestModuleImports('// export const imports = [];\nconst imports = [];\n').importNames).toBe(
      'ServerModule',
    );
  });

  it('falls back when there is no server.module.ts to read', () => {
    expect(serverTestModuleImports(undefined)).toEqual({ importNames: 'ServerModule', modules: 'ServerModule' });
  });
});
