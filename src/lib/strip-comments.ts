import * as ts from 'typescript';

/**
 * Removes comments from TypeScript/JavaScript source, preserving everything else verbatim.
 *
 * Exists because detectors that search source for import specifiers must not read comments as
 * code. A keyword-anchored regex is not sufficient on its own: a docblock that DOCUMENTS an import
 * rewrite legitimately quotes the exact syntax the detector looks for. nest-server-starter's
 * `tests/unit/bootstrap-diagnostics.spec.ts` contains
 *
 *   * CLI's vendor conversion rewrites `from '@lenne.tech/nest-server'` to a relative `./core` path
 *
 * which matched `/(?:from|import|…)\s*['"]@lenne\.tech\/nest-server['"]/` and made
 * `lt fullstack init --framework-mode vendor` warn about imports that file does not have.
 *
 * Uses the TypeScript scanner rather than a regex, so string literals, template literals and
 * regex literals containing `//` or `/*` are handled correctly by construction — a hand-rolled
 * stripper trips over `'https://…'` and over `/* ` inside a string.
 *
 * Comment characters are replaced with spaces instead of being deleted, so byte offsets and line
 * numbers of the surrounding code stay unchanged — a caller can still report a meaningful
 * position from a match.
 *
 * @param source - TypeScript or JavaScript source text
 * @returns The source with every comment blanked out
 *
 * @example
 * stripComments("// from 'pkg'\nimport x from 'pkg';")
 * // => "             \nimport x from 'pkg';"
 */
export function stripComments(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ false, ts.LanguageVariant.Standard, source);

  let result = '';
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const text = scanner.getTokenText();
    const isComment = token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia;
    // Keep newlines so line numbers survive; blank everything else in the comment.
    result += isComment ? text.replace(/[^\n]/g, ' ') : text;
    token = scanner.scan();
  }

  return result;
}
