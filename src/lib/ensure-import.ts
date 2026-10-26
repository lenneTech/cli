import { Project, SourceFile, SyntaxKind } from 'ts-morph';

/**
 * Make `sourceFile` import what the single import statement `line` imports.
 *
 * `lt server addProp` edits existing files, so the import a new property needs has to be
 * merged in rather than written as a block, the way the module generator does:
 *
 * - `import { A } from 'x';` / `import type { A } from 'x';` — `A` is added to an existing
 *   declaration of the same module and type-only-ness, or a new declaration is added.
 * - `import A = require('x');` — inserted verbatim after the last import.
 *
 * A name the file already imports (from any module, under any form) is left alone, so a
 * second run, or a hand-written import, never produces a duplicate. Returns true when the
 * file changed.
 */
export function ensureImportLine(sourceFile: SourceFile, line: string): boolean {
  const parsed = parseImportLine(line);
  if (!parsed) return false;

  const imported = importedNames(sourceFile);
  const missing = parsed.names.filter((name) => !imported.has(name));
  if (missing.length === 0) return false;

  if (parsed.kind === 'equals') {
    sourceFile.insertStatements(afterLastImport(sourceFile), line);
    return true;
  }

  const existing = sourceFile
    .getImportDeclarations()
    .find(
      (declaration) =>
        sameModule(declaration.getModuleSpecifierValue(), parsed.moduleSpecifier) &&
        declaration.isTypeOnly() === parsed.typeOnly &&
        !declaration.getNamespaceImport(),
    );
  if (existing) {
    existing.addNamedImports(missing);
  } else {
    // The statement as written, not `addImportDeclaration`: ts-morph would switch it to
    // double quotes, while the generated files use single quotes.
    const statement =
      missing.length === parsed.names.length
        ? line
        : `import ${parsed.typeOnly ? 'type ' : ''}{ ${missing.join(', ')} } from '${parsed.moduleSpecifier}';`;
    sourceFile.insertStatements(afterLastImport(sourceFile), statement);
  }
  return true;
}

/**
 * True when two specifiers name the same module up to the extension an ES module project adds:
 * `../../../core` and `../../../core/index.js`, `./x` and `./x.js`. The generators compute the
 * extensionless form; in an ESM project the file already carries the other one.
 */
export function sameModule(a: string, b: string): boolean {
  const strip = (specifier: string) => specifier.replace(/\/index\.[cm]?js$/, '').replace(/\.[cm]?js$/, '');
  return a === b || (a.startsWith('.') && b.startsWith('.') && strip(a) === strip(b));
}

/** Statement index right after the file's last import (0 when it has none). */
function afterLastImport(sourceFile: SourceFile): number {
  const imports = [
    ...sourceFile.getImportDeclarations(),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration),
  ];
  return imports.length > 0 ? Math.max(...imports.map((node) => node.getChildIndex())) + 1 : 0;
}

/** Every local name the file binds through an import statement. */
function importedNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) names.add(defaultImport.getText());
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) names.add(namespaceImport.getText());
    for (const named of declaration.getNamedImports()) {
      names.add(named.getAliasNode()?.getText() ?? named.getName());
    }
  }
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    names.add(declaration.getName());
  }
  return names;
}

/** Read one import statement with the compiler instead of a regex. */
function parseImportLine(
  line: string,
):
  | null
  | { kind: 'equals'; names: string[] }
  | { kind: 'named'; moduleSpecifier: string; names: string[]; typeOnly: boolean } {
  const scratch = new Project({ useInMemoryFileSystem: true }).createSourceFile('import.ts', line);
  const equals = scratch.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)[0];
  if (equals) {
    return { kind: 'equals', names: [equals.getName()] };
  }
  const declaration = scratch.getImportDeclarations()[0];
  if (!declaration || declaration.getDefaultImport() || declaration.getNamespaceImport()) {
    return null;
  }
  const names = declaration.getNamedImports().map((named) => named.getName());
  if (names.length === 0) return null;
  return {
    kind: 'named',
    moduleSpecifier: declaration.getModuleSpecifierValue(),
    names,
    typeOnly: declaration.isTypeOnly(),
  };
}
