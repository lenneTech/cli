import * as ts from 'typescript';

/**
 * What `lt server test` imports from `src/server/server.module.ts`, and what it hands to
 * `Test.createTestingModule`.
 *
 * The starter exports its module list as `imports` (nest-server-starter, 2025-05) so a test
 * boots the same global modules as the app: `imports: [...imports, ServerModule]`. A project
 * created before that exports only `ServerModule`, and importing `imports` there fails `tsc`
 * with TS2305, so it keeps the old `[ServerModule]`.
 */
export function serverTestModuleImports(serverModuleSource: string | undefined): {
  importNames: string;
  modules: string;
} {
  return exportsImportsList(serverModuleSource)
    ? { importNames: 'imports, ServerModule', modules: '...imports, ServerModule' }
    : { importNames: 'ServerModule', modules: 'ServerModule' };
}

/** True when the file exports a binding named `imports` (`export const imports` or `export { imports }`). */
function exportsImportsList(source: string | undefined): boolean {
  if (!source) return false;
  const file = ts.createSourceFile('server.module.ts', source, ts.ScriptTarget.Latest, false);
  return file.statements.some((statement) => {
    if (ts.isVariableStatement(statement)) {
      return (
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
        statement.declarationList.declarations.some(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'imports',
        )
      );
    }
    return (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      !!statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some((element) => element.name.text === 'imports')
    );
  });
}
