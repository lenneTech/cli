import { dirname, resolve } from 'path';
import { Node, SourceFile, SyntaxKind } from 'ts-morph';

/**
 * Relative module specifiers for an ES module project (`"type": "module"`).
 *
 * Node's ESM resolver does not complete a specifier: `./user.service` and `./modules` are not
 * found, only `./user.service.js` and `./modules/index.js` are. TypeScript under
 * `moduleResolution: nodenext` reports every relative import without its emitted extension
 * (TS2835), dynamic `import()` included. The emitted file of `x.ts` is `x.js`, so the specifier
 * names `.js` even though only `x.ts` exists on disk (nest-server migration guide 11.43.x →
 * 12.0.x, §17 step 2).
 *
 * Used by `lt server convert-esm` for a whole project and by the generators for the files they
 * write into an ESM project. A CommonJS project never goes through this: there ts-node, which
 * nest-server 11 projects start under, cannot resolve `./x.js` (see CLAUDE.md).
 */

/** Extensions TypeScript resolves a bare relative specifier to, with the extension Node needs. */
const SOURCE_EXTENSIONS: [string, string][] = [
  ['.ts', '.js'],
  ['.tsx', '.js'],
  ['.d.ts', '.js'],
  ['.js', '.js'],
  ['.mts', '.mjs'],
  ['.mjs', '.mjs'],
  ['.cts', '.cjs'],
  ['.cjs', '.cjs'],
];

/** A specifier that already names a file Node can load as it is. */
const HAS_RUNTIME_EXTENSION = /\.(?:[cm]?js|json|node)$/;

export interface SpecifierChange {
  from: string;
  line: number;
  to: string;
}

export interface SpecifierResult {
  changed: SpecifierChange[];
  /** Relative specifiers that resolve to no file: reported, never guessed. */
  unresolved: { line: number; specifier: string }[];
}

/**
 * Give every relative specifier in `sourceFile` the extension of its emitted file: static
 * imports and re-exports, `import()` calls with a string literal, and `import('./x')` types.
 * `exists` answers for absolute paths, so the function can run against an in-memory project.
 */
export function addJsExtensions(sourceFile: SourceFile, exists: (absolutePath: string) => boolean): SpecifierResult {
  const result: SpecifierResult = { changed: [], unresolved: [] };
  const fromDir = dirname(sourceFile.getFilePath());

  const visit = (literal: Node, specifier: string, apply: (next: string) => void) => {
    if (!isRelative(specifier) || HAS_RUNTIME_EXTENSION.test(specifier)) return;
    const next = resolveRuntimeSpecifier(fromDir, specifier, exists);
    const line = literal.getStartLineNumber();
    if (!next) {
      result.unresolved.push({ line, specifier });
      return;
    }
    if (next !== specifier) {
      apply(next);
      result.changed.push({ from: specifier, line, to: next });
    }
  };

  for (const declaration of sourceFile.getImportDeclarations()) {
    const literal = declaration.getModuleSpecifier();
    visit(literal, literal.getLiteralValue(), (next) => declaration.setModuleSpecifier(next));
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    const literal = declaration.getModuleSpecifier();
    if (!literal) continue;
    visit(literal, literal.getLiteralValue(), (next) => declaration.setModuleSpecifier(next));
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const [argument] = call.getArguments();
    if (!argument || (!Node.isStringLiteral(argument) && !Node.isNoSubstitutionTemplateLiteral(argument))) continue;
    visit(argument, argument.getLiteralValue(), (next) => argument.setLiteralValue(next));
  }
  for (const importType of sourceFile.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const argument = importType.getArgument();
    if (!Node.isLiteralTypeNode(argument)) continue;
    const literal = argument.getLiteral();
    if (!Node.isStringLiteral(literal)) continue;
    visit(literal, literal.getLiteralValue(), (next) => literal.setLiteralValue(next));
  }
  return result;
}

/**
 * The specifier Node needs for `specifier`, seen from `fromDir`, or `undefined` when nothing on
 * disk matches. A file wins over a directory of the same name, as in TypeScript's resolution.
 */
export function resolveRuntimeSpecifier(
  fromDir: string,
  specifier: string,
  exists: (absolutePath: string) => boolean,
): string | undefined {
  const base = resolve(fromDir, specifier);
  for (const [sourceExtension, runtimeExtension] of SOURCE_EXTENSIONS) {
    if (exists(`${base}${sourceExtension}`)) return `${specifier}${runtimeExtension}`;
  }
  for (const [sourceExtension, runtimeExtension] of SOURCE_EXTENSIONS) {
    if (exists(resolve(base, `index${sourceExtension}`))) {
      return `${specifier.replace(/\/$/, '')}/index${runtimeExtension}`;
    }
  }
  return undefined;
}

function isRelative(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}
