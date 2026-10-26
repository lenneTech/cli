import { ClassDeclaration, Node, Project, SourceFile, SyntaxKind, TypeNode } from 'ts-morph';

/**
 * Import cycles that break an ES module at start-up (nest-server migration guide 11.43.x →
 * 12.0.x, §17 step 7).
 *
 * With `emitDecoratorMetadata`, a decorated property, parameter or method records its type as a
 * runtime value (`design:type`, `design:paramtypes`, `design:returntype`) the moment the class is
 * defined. When that type is a class from a module on the same import cycle, the module may not
 * have finished loading. CommonJS reads `undefined` and carries on; ESM throws
 * `ReferenceError: Cannot access 'X' before initialization`. The guide's fix is
 * `WrapperType<X>`, which nest-server exports: the decorator keeps the real type through its thunk.
 *
 * Reported, never rewritten (the user's decision): which side of a cycle to wrap is a design
 * call, and both sides can be on it. Only VALUE imports form edges, because type-only imports
 * are erased and cannot take part in a runtime cycle.
 */

export interface CycleFinding {
  /** The class the declaration's type names. */
  className: string;
  /** Files of the cycle, relative to nothing: absolute, in a stable order. */
  cycle: string[];
  file: string;
  line: number;
  text: string;
}

export function findDecoratedCycleUses(project: Project, include: (file: SourceFile) => boolean): CycleFinding[] {
  const files = project.getSourceFiles().filter(include);
  const graph = new Map<SourceFile, Set<SourceFile>>();
  for (const file of files) graph.set(file, new Set(valueImportTargets(file).filter((target) => include(target))));

  const findings: CycleFinding[] = [];
  for (const component of stronglyConnected(graph)) {
    const members = new Set(component);
    if (component.length === 1 && !graph.get(component[0])?.has(component[0])) continue;
    const cycle = component.map((file) => file.getFilePath()).sort();
    for (const file of component) {
      for (const use of decoratedClassTypeUses(file)) {
        if (members.has(use.from)) {
          findings.push({ className: use.className, cycle, file: file.getFilePath(), line: use.line, text: use.text });
        }
      }
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Classes named in decorated signatures of `file`, with the module each one is imported from. */
function decoratedClassTypeUses(
  file: SourceFile,
): { className: string; from: SourceFile; line: number; text: string }[] {
  const imported = new Map<string, SourceFile>();
  for (const declaration of file.getImportDeclarations()) {
    if (declaration.isTypeOnly()) continue;
    const target = declaration.getModuleSpecifierSourceFile();
    if (!target) continue;
    for (const element of declaration.getNamedImports()) {
      if (element.isTypeOnly()) continue;
      imported.set(element.getAliasNode()?.getText() ?? element.getName(), target);
    }
  }
  if (imported.size === 0) return [];

  const uses: { className: string; from: SourceFile; line: number; text: string }[] = [];
  const check = (owner: Node, typeNode: TypeNode | undefined) => {
    if (!typeNode) return;
    const name = metadataTypeName(typeNode);
    const from = name ? imported.get(name) : undefined;
    if (name && from && exportsClass(from, name)) {
      uses.push({
        className: name,
        from,
        line: owner.getStartLineNumber(),
        text: owner.getText().split('\n')[0].trim(),
      });
    }
  };

  for (const cls of file.getClasses()) {
    for (const property of cls.getProperties()) {
      if (property.getDecorators().length > 0) check(property, property.getTypeNode());
    }
    for (const method of cls.getMethods()) {
      const decorated = method.getDecorators().length > 0;
      if (decorated) check(method, method.getReturnTypeNode());
      for (const parameter of method.getParameters()) {
        if (decorated || parameter.getDecorators().length > 0) check(parameter, parameter.getTypeNode());
      }
    }
    for (const constructor of cls.getConstructors()) {
      const decoratedClass = cls.getDecorators().length > 0;
      for (const parameter of constructor.getParameters()) {
        if (decoratedClass || parameter.getDecorators().length > 0) check(parameter, parameter.getTypeNode());
      }
    }
  }
  return uses;
}

/** True when `file` declares or re-exports a class called `name`. */
function exportsClass(file: SourceFile, name: string): boolean {
  const declarations = file.getExportedDeclarations().get(name) ?? [];
  return declarations.some((declaration) => declaration instanceof ClassDeclaration);
}

/**
 * The class name TypeScript writes into the metadata for `typeNode`: a plain type reference, or
 * the element type of an array (`design:type` is then `Array`, but the type is still read when
 * the decorator's thunk is not used). `WrapperType<X>` is the fix and is not reported.
 */
function metadataTypeName(typeNode: TypeNode): string | undefined {
  if (Node.isArrayTypeNode(typeNode)) return metadataTypeName(typeNode.getElementTypeNode());
  if (Node.isTypeReference(typeNode)) {
    const name = typeNode.getTypeName().getText();
    if (name === 'WrapperType' || name === 'Promise') return undefined;
    return name.split('.')[0];
  }
  if (typeNode.getKind() === SyntaxKind.ParenthesizedType) {
    const inner = typeNode.getFirstChildByKind(SyntaxKind.TypeReference);
    return inner ? metadataTypeName(inner) : undefined;
  }
  return undefined;
}

/** Strongly connected components (Tarjan), iterative so deep graphs cannot overflow the stack. */
function stronglyConnected(graph: Map<SourceFile, Set<SourceFile>>): SourceFile[][] {
  const index = new Map<SourceFile, number>();
  const low = new Map<SourceFile, number>();
  const onStack = new Set<SourceFile>();
  const stack: SourceFile[] = [];
  const components: SourceFile[][] = [];
  let counter = 0;

  for (const root of graph.keys()) {
    if (index.has(root)) continue;
    const work: { iterator: Iterator<SourceFile>; node: SourceFile }[] = [];
    const enter = (node: SourceFile) => {
      index.set(node, counter);
      low.set(node, counter);
      counter++;
      stack.push(node);
      onStack.add(node);
      work.push({ iterator: (graph.get(node) ?? new Set<SourceFile>()).values(), node });
    };
    enter(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const next = frame.iterator.next();
      if (!next.done) {
        const target = next.value;
        if (!index.has(target)) enter(target);
        else if (onStack.has(target)) low.set(frame.node, Math.min(low.get(frame.node), index.get(target)));
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: SourceFile[] = [];
        let member: SourceFile;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        components.push(component);
      }
    }
  }
  return components;
}

/** Project files `file` imports or re-exports as values (type-only imports are erased). */
function valueImportTargets(file: SourceFile): SourceFile[] {
  const targets: SourceFile[] = [];
  for (const declaration of file.getImportDeclarations()) {
    if (declaration.isTypeOnly()) continue;
    const named = declaration.getNamedImports();
    const onlyTypes =
      named.length > 0 && named.every((element) => element.isTypeOnly()) && !declaration.getDefaultImport();
    if (onlyTypes) continue;
    const target = declaration.getModuleSpecifierSourceFile();
    if (target) targets.push(target);
  }
  for (const declaration of file.getExportDeclarations()) {
    if (declaration.isTypeOnly()) continue;
    const target = declaration.getModuleSpecifierSourceFile();
    if (target) targets.push(target);
  }
  return targets;
}
