/**
 * Under `isolatedModules` + `emitDecoratorMetadata`, an interface in a decorated signature must
 * come through `import type` (TS1272), and a class that drives dependency injection must NOT.
 */
import { Project, ts } from 'ts-morph';

import { moveDecoratedTypesToTypeImports, splitTypeImports } from '../src/lib/esm-type-imports';

function decoratedProject() {
  const project = new Project({
    compilerOptions: {
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      isolatedModules: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    },
    useInMemoryFileSystem: true,
  });
  project.createSourceFile('/app/package.json', '{ "type": "module" }');
  project.createSourceFile(
    '/app/options.ts',
    'export interface ServiceOptions { force?: boolean }\nexport class UserService {}\n',
  );
  project.createSourceFile('/app/inject.ts', 'export function Inject(): ParameterDecorator { return () => undefined; }\n');
  const consumer = project.createSourceFile(
    '/app/consumer.ts',
    [
      "import { Inject } from './inject.js';",
      "import { ServiceOptions, UserService } from './options.js';",
      '',
      'export class Consumer {',
      '  constructor(@Inject() private readonly users: UserService, @Inject() private readonly options: ServiceOptions) {}',
      '}',
      '',
    ].join('\n'),
  );
  return { consumer, project };
}

describe('moveDecoratedTypesToTypeImports', () => {
  it('moves the interface into import type and keeps the injected class a value import', () => {
    const { consumer, project } = decoratedProject();
    const ts1272 = () => project.getPreEmitDiagnostics().filter((d) => d.getCode() === 1272);
    expect(ts1272().length).toBeGreaterThan(0);

    const fixes = moveDecoratedTypesToTypeImports(project);

    expect(fixes).toEqual([{ file: '/app/consumer.ts', names: ['ServiceOptions'] }]);
    expect(consumer.getFullText()).toContain("import { type ServiceOptions, UserService } from './options.js';");
    expect(ts1272()).toEqual([]);
  });

  it('turns a declaration that imports only types into one import type', () => {
    const source = new Project({ useInMemoryFileSystem: true }).createSourceFile(
      '/a.ts',
      "import { A, B as C } from './x.js';\n",
    );
    expect(splitTypeImports(source, new Set(['A', 'C']))).toEqual(['A', 'C']);
    expect(source.getFullText()).toBe("import type { A, B as C } from './x.js';\n");
  });
});
