import { Project, SourceFile } from 'ts-morph';

/**
 * TS1272: a type referenced in a decorated signature must be imported with `import type` when
 * `isolatedModules` and `emitDecoratorMetadata` are both on (nest-server migration guide
 * 11.43.x → 12.0.x, §17 step 5). Under ESM a value import of an interface would ask the module
 * for a binding that does not exist at runtime.
 *
 * TypeScript itself decides what counts: the diagnostic fires only for a name that is not a
 * value, so a class that drives dependency injection is never moved (moving it would erase the
 * metadata Nest injects by). TypeScript's own codefix offers a namespace import only, so the
 * names are marked `type` inline (`import { A, type B }`), or the whole declaration becomes
 * `import type` when nothing else is left in it, with the specifier written exactly as before.
 * Runs in rounds, because a fix can surface the next diagnostic.
 */

export interface TypeImportFix {
  file: string;
  names: string[];
}

const TS1272 = 1272;
const MAX_ROUNDS = 10;

export function moveDecoratedTypesToTypeImports(project: Project): TypeImportFix[] {
  const fixes: TypeImportFix[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const namesByFile = new Map<SourceFile, Set<string>>();
    for (const diagnostic of project.getPreEmitDiagnostics()) {
      if (diagnostic.getCode() !== TS1272) continue;
      const sourceFile = diagnostic.getSourceFile();
      const start = diagnostic.getStart();
      const length = diagnostic.getLength();
      if (!sourceFile || start === undefined || length === undefined) continue;
      const name = sourceFile
        .getFullText()
        .slice(start, start + length)
        .split('.')[0];
      if (!namesByFile.has(sourceFile)) namesByFile.set(sourceFile, new Set());
      namesByFile.get(sourceFile).add(name);
    }
    if (namesByFile.size === 0) break;

    let progress = false;
    for (const [sourceFile, names] of namesByFile) {
      const moved = splitTypeImports(sourceFile, names);
      if (moved.length > 0) {
        progress = true;
        fixes.push({ file: sourceFile.getFilePath(), names: moved });
      }
    }
    if (!progress) break; // the remaining diagnostics are not about an import this can split
  }
  return fixes;
}

/** Move `names` out of value imports into `import type` declarations; returns what moved. */
export function splitTypeImports(sourceFile: SourceFile, names: Set<string>): string[] {
  const moved: string[] = [];
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (declaration.isTypeOnly()) continue;
    const elements = declaration
      .getNamedImports()
      .filter((element) => !element.isTypeOnly() && names.has(element.getAliasNode()?.getText() ?? element.getName()));
    if (elements.length === 0) continue;
    const specifier = declaration.getModuleSpecifier().getText();
    const typeImport = `import type { ${elements.map((element) => element.getText()).join(', ')} } from ${specifier};`;
    moved.push(...elements.map((element) => element.getAliasNode()?.getText() ?? element.getName()));

    const keepsSomething = !!declaration.getDefaultImport() || declaration.getNamedImports().length > elements.length;
    if (keepsSomething) {
      // `import { A, type B }`: one declaration per module, which TS1272 accepts as well.
      for (const element of elements) element.setIsTypeOnly(true);
    } else {
      declaration.replaceWithText(typeImport);
    }
  }
  return moved;
}
