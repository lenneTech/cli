/**
 * The module specifiers a file imports — read from the syntax tree, never from text.
 *
 * The detectors that ask "does this file still import X?" used to search the raw source
 * and blank out comments first, because a docblock that DOCUMENTS the conversion quotes
 * the very syntax they look for (`nest-server-starter`'s
 * `tests/unit/bootstrap-diagnostics.spec.ts` names `from '@lenne.tech/nest-server'` in
 * prose, and the detector told the user to rewrite imports that file does not have).
 *
 * That workaround does not hold. `stripComments` drives a standalone `ts.createScanner`
 * in a plain `scan()` loop, and a template literal WITH a substitution cannot be read
 * that way: the scanner hands back `TemplateHead` and needs `reScanTemplateToken()` to
 * continue. Without it every token after the first `` `x${…}` `` is misread, so comments
 * from there on pass through verbatim. Bisected on `src/templates/check/check.mjs`: the
 * first surviving comment appears right after `` `${s.toFixed(1)}s` `` on line 70, and a
 * two-line fixture reproduces it. A plain template without substitution is fine; regex
 * literals and division — the first suspects — are not the cause.
 * Since template literals are everywhere, degradation was present in 23 of 76 real
 * frontend files and 21 of 50 backend files; only the absence of a needle-quoting
 * comment BELOW such a template kept it from producing false alarms.
 *
 * Asking the parser removes the whole class: a comment is not part of the AST, so there
 * is nothing to strip and nothing to get wrong.
 */
import * as ts from 'typescript';

/** `<script>` / `<script setup>` blocks of a Vue SFC, which is not valid TypeScript as a whole. */
const VUE_SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Same, for a file on disk. A `.vue` SFC is not valid TypeScript, so its `<script>`
 * blocks are extracted first and parsed individually — the template and style blocks
 * cannot contain imports and are skipped. Everything else is parsed as-is.
 *
 * @returns The specifiers, or `[]` when the file cannot be read.
 */
export function fileImportedSpecifiers(filePath: string, read: (path: string) => string | undefined): string[] {
  const source = read(filePath);
  if (!source) {
    return [];
  }
  if (!filePath.endsWith('.vue')) {
    return importedSpecifiers(source, filePath);
  }
  const specifiers: string[] = [];
  for (const [, block] of source.matchAll(VUE_SCRIPT_BLOCK)) {
    specifiers.push(...importedSpecifiers(block, `${filePath}.ts`));
  }
  return specifiers;
}

/**
 * Every module specifier `source` imports, exports from, dynamically imports or
 * requires. Duplicates are preserved; order follows the file.
 *
 * Covers `import x from 'y'`, `import 'y'`, `export … from 'y'`, `export * from 'y'`,
 * `import y = require('y')`, `await import('y')` and `require('y')`.
 *
 * @param source The file's text.
 * @param fileName Only used to pick the parser dialect (`.tsx` vs `.ts`).
 */
export function importedSpecifiers(source: string, fileName = 'file.ts'): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  const literalText = (node: ts.Node | undefined): null | string =>
    node && ts.isStringLiteralLike(node) ? node.text : null;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const text = literalText(node.moduleSpecifier);
      if (text !== null) {
        specifiers.push(text);
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const text = literalText(node.moduleReference.expression);
      if (text !== null) {
        specifiers.push(text);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) {
        const text = literalText(node.arguments[0]);
        if (text !== null) {
          specifiers.push(text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

/** True when `specifier` is `pkg` itself or a deep import of it (`pkg/sub/path`). */
export function isPackageImport(specifier: string, pkg: string): boolean {
  return specifier === pkg || specifier.startsWith(`${pkg}/`);
}

/**
 * True when `specifier` is a relative path whose last segment is `core`, or that leads
 * into a `core` directory — `./core`, `../core`, `../../core/utils`.
 */
export function isRelativeCoreImport(specifier: string): boolean {
  if (!specifier.startsWith('.')) {
    return false;
  }
  return specifier.split('/').includes('core');
}
