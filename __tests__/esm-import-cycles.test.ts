/**
 * Two models that reference each other: CommonJS reads the not-yet-initialised class as
 * `undefined`, ESM throws `Cannot access 'X' before initialization` at start-up. The command
 * reports such declarations with file and line and the `WrapperType<X>` fix; it never rewrites.
 */
import { Project, ts } from 'ts-morph';

import { findDecoratedCycleUses } from '../src/lib/esm-import-cycles';

function models(files: Record<string, string>) {
  const project = new Project({
    compilerOptions: { experimentalDecorators: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    useInMemoryFileSystem: true,
  });
  project.createSourceFile('/app/field.ts', 'export function Field(): PropertyDecorator { return () => undefined; }\n');
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  return project;
}

describe('findDecoratedCycleUses', () => {
  it('reports a decorated property typed with a class from the same cycle', () => {
    const project = models({
      '/app/project.model.ts': [
        "import { Field } from './field';",
        "import { User } from './user.model';",
        'export class Project {',
        '  @Field() owner?: User;',
        '}',
        '',
      ].join('\n'),
      '/app/user.model.ts': [
        "import { Field } from './field';",
        "import { Project } from './project.model';",
        'export class User {',
        '  @Field() projects?: Project[];',
        '  name?: Project;',
        '}',
        '',
      ].join('\n'),
    });

    const findings = findDecoratedCycleUses(project, () => true);

    expect(findings.map(({ className, file, line }) => ({ className, file, line }))).toEqual([
      { className: 'User', file: '/app/project.model.ts', line: 4 },
      { className: 'Project', file: '/app/user.model.ts', line: 4 },
    ]);
    expect(findings[0].cycle).toEqual(['/app/project.model.ts', '/app/user.model.ts']);
  });

  it('stays quiet without a cycle, for type-only imports and for WrapperType', () => {
    const project = models({
      '/app/a.model.ts': [
        "import { Field } from './field';",
        "import type { B } from './b.model';",
        "import { C } from './c.model';",
        'export class A {',
        '  @Field() b?: B;',
        '  @Field() c?: WrapperType<C>;',
        '}',
        'type WrapperType<T> = T;',
        '',
      ].join('\n'),
      '/app/b.model.ts': "import { A } from './a.model';\nexport class B { a?: A }\n",
      '/app/c.model.ts': "import { A } from './a.model';\nexport class C { a?: A }\n",
    });

    expect(findDecoratedCycleUses(project, () => true)).toEqual([]);
  });
});
