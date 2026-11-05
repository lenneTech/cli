import * as path from 'path';

/**
 * The project's own TypeScript in an API project, relative to its root: what a
 * mode conversion rewrites between `@lenne.tech/nest-server` and the vendored
 * `src/core/`, in both directions, and what `findStaleImports` scans afterwards.
 *
 * One list for all three. There used to be three copies, and each named only
 * `src/main.ts` and `src/config.env.ts` from the `src/` root. In nest-server-starter
 * 12.4.0, `src/config.env.spec.ts` (there since 11.34.0) got its first import from
 * the package: the vendor conversion left that import in place, the project failed
 * `typecheck:tests` with TS2307, and the stale-import check, reading the same
 * short list, reported nothing.
 *
 * `src/*.ts` stays one level deep: below it, `src/core/` is the framework itself,
 * and only `src/server/` holds project code.
 */
export const CONSUMER_SOURCE_GLOBS: readonly string[] = [
  'src/*.ts',
  'src/server/**/*.ts',
  'tests/**/*.ts',
  'migrations/**/*.ts',
  'migrations-utils/*.ts',
  'scripts/**/*.ts',
];

/** `CONSUMER_SOURCE_GLOBS` below `root`, in the form ts-morph's `addSourceFilesAtPaths` takes. */
export function consumerSourceGlobs(root: string): string[] {
  return CONSUMER_SOURCE_GLOBS.map((glob) => `${root}/${glob}`);
}

/**
 * Point every `@lenne.tech/nest-server` import, re-export, dynamic `import()` and
 * `require()` in the project's own code at the vendored core, by a path relative
 * to each file (`./core` from `src/`, `../../../core` from `src/server/modules/x/`).
 * Files inside `coreDir` are the framework and are never touched.
 *
 * @returns the files that were rewritten
 */
export function rewriteFrameworkImportsToCore(options: { coreDir: string; dest: string }): string[] {
  const { coreDir, dest } = options;
  // Lazy: gluegun loads every command on every `lt` run, and ts-morph is large.
  const { Project, SyntaxKind } = require('ts-morph');
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(consumerSourceGlobs(dest));

  const rewritten: string[] = [];
  for (const file of project.getSourceFiles()) {
    const filePath = file.getFilePath();
    if (filePath.startsWith(coreDir)) continue;

    let relToCore = path.relative(path.dirname(filePath), coreDir).split(path.sep).join('/');
    if (!relToCore.startsWith('.')) {
      relToCore = `./${relToCore}`;
    }

    let touched = false;

    // Static import and export (re-export) declarations
    for (const decl of [...file.getImportDeclarations(), ...file.getExportDeclarations()]) {
      if (decl.getModuleSpecifierValue() === '@lenne.tech/nest-server') {
        decl.setModuleSpecifier(relToCore);
        touched = true;
      }
    }
    // Dynamic imports + CJS require('@lenne.tech/nest-server')
    file.forEachDescendant((node: any) => {
      if (node.getKind() !== SyntaxKind.CallExpression) return;
      const expr = node.getExpression();
      const args = node.getArguments();
      if (args.length === 0) return;
      const firstArg = args[0];
      if (firstArg.getKind() !== SyntaxKind.StringLiteral) return;
      if (firstArg.getLiteralText() !== '@lenne.tech/nest-server') return;

      if (expr.getText() === 'require' || expr.getText() === 'import' || expr.getKind() === SyntaxKind.ImportKeyword) {
        firstArg.replaceWithText(`'${relToCore}'`);
        touched = true;
      }
    });

    if (touched) {
      file.saveSync();
      rewritten.push(filePath);
    }
  }
  return rewritten;
}
