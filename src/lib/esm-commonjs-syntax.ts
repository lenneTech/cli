import { Node, SourceFile, SyntaxKind } from 'ts-morph';

/**
 * CommonJS constructs an ES module cannot keep (nest-server migration guide 11.43.x → 12.0.x,
 * §17 step 3), rewritten where the replacement is exact and reported where it is not:
 *
 * - `import x = require('pkg')` → `import x from 'pkg'`; Node hands an ES module the CommonJS
 *   `module.exports` as the default export, which is what `import x = require()` bound.
 * - a JSON import gets `with { type: 'json' }`, which Node requires for JSON in ESM.
 * - `__dirname` / `__filename` → `import.meta.dirname` / `import.meta.filename` (Node 20.11+).
 *   A file that declares its own `__dirname` (the `fileURLToPath(import.meta.url)` idiom) is
 *   already ESM-ready and stays as it is.
 * - `require()`, `require.resolve()`, `module.exports` and `exports.x` are reported with their
 *   line: the right replacement (a static import, `import()`, `createRequire`) depends on why the
 *   file loads synchronously, which the syntax does not say. A file that creates its own
 *   `require` with `createRequire` is left alone.
 */

export interface SyntaxChange {
  line: number;
  what: string;
}

export interface SyntaxFinding {
  line: number;
  text: string;
  why: string;
}

const JSON_SPECIFIER = /\.json$/;

export function convertCommonJsSyntax(sourceFile: SourceFile): { changed: SyntaxChange[]; reported: SyntaxFinding[] } {
  const changed: SyntaxChange[] = [];
  const reported: SyntaxFinding[] = [];

  // 1. import x = require('…')
  for (const declaration of [...sourceFile.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)].reverse()) {
    const reference = declaration.getModuleReference();
    const line = declaration.getStartLineNumber();
    if (!Node.isExternalModuleReference(reference)) continue; // `import x = Namespace.Y`, not CommonJS
    const literal = reference.getExpression();
    if (!literal || !Node.isStringLiteral(literal) || declaration.isExported()) {
      reported.push({ line, text: declaration.getText(), why: 'no exact ES module equivalent, convert by hand' });
      continue;
    }
    const specifier = literal.getText();
    const typeOnly = declaration.isTypeOnly() ? 'type ' : '';
    const attributes = JSON_SPECIFIER.test(literal.getLiteralValue()) ? " with { type: 'json' }" : '';
    declaration.replaceWithText(`import ${typeOnly}${declaration.getName()} from ${specifier}${attributes};`);
    changed.push({ line, what: 'import = require → default import' });
  }

  // 2. JSON imports without the attribute Node requires
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (!JSON_SPECIFIER.test(declaration.getModuleSpecifierValue())) continue;
    if (declaration.getAttributes()) continue;
    const line = declaration.getStartLineNumber();
    if (declaration.getNamedImports().length > 0 || declaration.getNamespaceImport()) {
      reported.push({ line, text: declaration.getText(), why: 'ES modules import JSON as a default export only' });
      continue;
    }
    declaration.replaceWithText(declaration.getText().replace(/;?\s*$/, " with { type: 'json' };"));
    changed.push({ line, what: "JSON import: with { type: 'json' }" });
  }

  // 3. __dirname / __filename
  const declared = new Set<string>(
    sourceFile
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .map((declaration) => declaration.getName())
      .filter((name) => name === '__dirname' || name === '__filename' || name === 'require'),
  );
  // A Map, not an object literal: `name in {…}` walks the prototype chain, so an identifier named
  // `toString` or `constructor` (a typed ObjectId `{ toString(): string }`, a local `constructor`)
  // matched and the rewrite crashed mid-conversion (review, 2026-10-26).
  const replacements = new Map([
    ['__dirname', 'import.meta.dirname'],
    ['__filename', 'import.meta.filename'],
  ]);
  for (const identifier of [...sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)].reverse()) {
    const name = identifier.getText();
    const replacement = replacements.get(name);
    if (!replacement || declared.has(name) || !isFreeReference(identifier)) continue;
    const line = identifier.getStartLineNumber();
    identifier.replaceWithText(replacement);
    changed.push({ line, what: `${name} → ${replacement}` });
  }

  // 4. What has no exact replacement
  if (!declared.has('require')) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      const isRequire =
        (Node.isIdentifier(callee) && callee.getText() === 'require') ||
        (Node.isPropertyAccessExpression(callee) && callee.getExpression().getText() === 'require');
      if (isRequire) {
        reported.push({
          line: call.getStartLineNumber(),
          text: call.getText(),
          why: 'require is not defined in an ES module: use a static import, import(), or createRequire(import.meta.url)',
        });
      }
    }
  }
  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const target = access.getExpression().getText();
    if (
      (target === 'module' && access.getName() === 'exports') ||
      (target === 'exports' && isFreeReference(access.getExpression()))
    ) {
      reported.push({
        line: access.getStartLineNumber(),
        text: access.getText(),
        why: 'CommonJS export: use export / export default',
      });
    }
  }
  return { changed, reported: dedupe(reported) };
}

function dedupe(findings: SyntaxFinding[]): SyntaxFinding[] {
  const seen = new Set<string>();
  return findings
    .sort((a, b) => a.line - b.line)
    .filter((finding) => {
      const key = `${finding.line}:${finding.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** An identifier used as a value of its own, not a property name, a declaration or a key. */
function isFreeReference(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return true;
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) return false;
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return false;
  if (Node.isPropertyDeclaration(parent) || Node.isPropertySignature(parent) || Node.isMethodDeclaration(parent)) {
    return parent.getNameNode() !== node;
  }
  if (Node.isVariableDeclaration(parent) || Node.isParameterDeclaration(parent) || Node.isBindingElement(parent)) {
    return parent.getNameNode() !== node;
  }
  if (Node.isImportSpecifier(parent) || Node.isExportSpecifier(parent) || Node.isQualifiedName(parent)) return false;
  return true;
}
