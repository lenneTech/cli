import { posix } from 'path';
import { Node, SourceFile, SyntaxKind } from 'ts-morph';

import { resolveRuntimeSpecifier } from './esm-specifiers';

/**
 * A plain JavaScript CommonJS module turned into an ES module, for the files a project keeps as
 * `.js` next to its TypeScript: `migrations-utils/migrate.js` and `mongo-uri.js` (nest-server
 * migration guide 11.43.x → 12.0.x, §17 step 4: "the migrate CLI reads the default export").
 *
 * - top-level `const x = require('m')` / `const { a, b } = require('m')` → `import`
 * - `module.exports = { a, b }` (shorthand only) → `export { a, b }`
 * - `module.exports = <expression>` → `export default <expression>`
 * - a `require()` that is not one of those (inside a function, conditional, `require.resolve`)
 *   stays synchronous through `createRequire(import.meta.url)`, which keeps the meaning exactly.
 *   That is the starter's own plan for `mongo-uri.js`, which loads `config.env` lazily so the
 *   production image can fall back to `NSC__MONGOOSE__URI`.
 *
 * `exports.x = …` and anything else exported in a CommonJS way is reported, not guessed.
 */
export function convertCommonJsModule(
  sourceFile: SourceFile,
  exists: (absolutePath: string) => boolean,
): { changed: boolean; reported: { line: number; text: string }[] } {
  const reported: { line: number; text: string }[] = [];
  // Already an ES module: leave it. That makes the conversion idempotent, and it keeps a
  // deliberate `createRequire` require (the vendor migration store loads the helper that way,
  // because `import` would skip the loader's require hook) from being turned back into an import.
  const isEsm =
    sourceFile.getImportDeclarations().length > 0 ||
    sourceFile.getExportDeclarations().length > 0 ||
    sourceFile.getExportAssignments().length > 0 ||
    sourceFile
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .some((declaration) => declaration.getName() === 'require');
  if (isEsm) return { changed: false, reported };
  const fromDir = posix.dirname(sourceFile.getFilePath());
  const esmSpecifier = (specifier: string) =>
    specifier.startsWith('.') ? (resolveRuntimeSpecifier(fromDir, specifier, exists) ?? specifier) : specifier;
  let changed = false;

  // Top-level `const … = require('…')`
  for (const statement of sourceFile.getVariableStatements()) {
    const declarations = statement.getDeclarations();
    if (declarations.length !== 1) continue;
    const [declaration] = declarations;
    const initializer = declaration.getInitializer();
    if (!initializer || !Node.isCallExpression(initializer)) continue;
    if (initializer.getExpression().getText() !== 'require') continue;
    const [argument] = initializer.getArguments();
    if (!argument || !Node.isStringLiteral(argument)) continue;
    const specifier = `'${esmSpecifier(argument.getLiteralValue())}'`;
    const nameNode = declaration.getNameNode();
    if (Node.isIdentifier(nameNode)) {
      statement.replaceWithText(`import ${nameNode.getText()} from ${specifier};`);
      changed = true;
    } else if (
      Node.isObjectBindingPattern(nameNode) &&
      nameNode.getElements().every((element) => !element.getDotDotDotToken())
    ) {
      const names = nameNode
        .getElements()
        .map((element) => {
          const property = element.getPropertyNameNode()?.getText();
          return property ? `${property} as ${element.getName()}` : element.getName();
        })
        .join(', ');
      statement.replaceWithText(`import { ${names} } from ${specifier};`);
      changed = true;
    }
  }

  // module.exports = …
  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const expression = statement.getExpression();
    if (!Node.isBinaryExpression(expression) || expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken)
      continue;
    if (expression.getLeft().getText() !== 'module.exports') continue;
    const right = expression.getRight();
    if (
      Node.isObjectLiteralExpression(right) &&
      right.getProperties().every((property) => Node.isShorthandPropertyAssignment(property))
    ) {
      statement.replaceWithText(
        `export { ${right
          .getProperties()
          .map((property) => property.getText())
          .join(', ')} };`,
      );
    } else {
      statement.replaceWithText(`export default ${right.getText()};`);
    }
    changed = true;
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const target = access.getExpression().getText();
    if (target === 'exports' || (target === 'module' && access.getName() === 'exports')) {
      reported.push({ line: access.getStartLineNumber(), text: access.getParent()?.getText() ?? access.getText() });
    }
  }

  // Whatever `require` is left keeps working synchronously.
  const remainingRequire = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => {
    if (identifier.getText() !== 'require') return false;
    const parent = identifier.getParent();
    return (
      (Node.isCallExpression(parent) && parent.getExpression() === identifier) ||
      (Node.isPropertyAccessExpression(parent) && parent.getExpression() === identifier)
    );
  });
  const declaresRequire = sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .some((declaration) => declaration.getName() === 'require');
  if (remainingRequire && !declaresRequire) {
    const imports = sourceFile.getImportDeclarations();
    const lastImport = imports[imports.length - 1];
    const index = lastImport ? lastImport.getChildIndex() + 1 : leadingCommentEnd(sourceFile);
    sourceFile.insertStatements(
      index,
      "import { createRequire } from 'node:module';\n\nconst require = createRequire(import.meta.url);\n",
    );
    changed = true;
  }
  return { changed, reported };
}

/** Index after a file's leading statements that are only `'use strict'`, which ESM drops. */
function leadingCommentEnd(sourceFile: SourceFile): number {
  const first = sourceFile.getStatements()[0];
  if (first && Node.isExpressionStatement(first) && /^['"]use strict['"]$/.test(first.getExpression().getText())) {
    first.remove();
  }
  return 0;
}
