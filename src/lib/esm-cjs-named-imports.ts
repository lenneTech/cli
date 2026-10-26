import { spawnSync } from 'child_process';
import { isBuiltin } from 'module';
import { Project, SourceFile, ts } from 'ts-morph';

/**
 * Named imports of a CommonJS package that Node's ESM loader cannot see (nest-server migration
 * guide 11.43.x → 12.0.x, §17 step 6).
 *
 * An ES module learns a CommonJS module's export names by static analysis
 * (cjs-module-lexer), which misses names a package assigns dynamically:
 * `import { cloneDeep } from 'lodash'` and `import { Connection } from 'mongoose'` then fail with
 * `does not provide an export named …` at start-up. vitest is more lenient than Node, so the test
 * suite passes over it (489 green tests and a dead production start on the starter).
 *
 * Neither side is guessed. What matters is what survives TypeScript's emit (an import used only
 * as a type is erased and harmless), so each file is emitted with the project's ESM settings;
 * what Node sees is asked of Node itself, by importing each package from the project directory.
 * Reported, never rewritten: whether the fix is `import type` or the default import depends on
 * how the name is used.
 */

export interface NamedImportFinding extends NamedImportRequest {
  why: string;
}

export interface NamedImportRequest {
  file: string;
  line: number;
  name: string;
  specifier: string;
}

/**
 * Ask Node which named exports each package offers to an ES module, by importing it from
 * `projectDir`. One process for all packages. A package that cannot be imported at all is
 * reported once, with Node's own error code.
 */
export function checkNamedImportsAgainstNode(
  projectDir: string,
  requests: NamedImportRequest[],
  importNamespaces: (
    projectDir: string,
    specifiers: string[],
  ) => Record<string, string[] | { error: string }> = importWithNode,
): NamedImportFinding[] {
  const specifiers = [...new Set(requests.map((request) => request.specifier))].filter(
    (specifier) => !isBuiltin(specifier),
  );
  if (specifiers.length === 0) return [];
  const namespaces = importNamespaces(projectDir, specifiers);
  const findings: NamedImportFinding[] = [];
  const reportedErrors = new Set<string>();
  for (const request of requests) {
    const namespace = namespaces[request.specifier];
    if (!namespace) continue;
    if (!Array.isArray(namespace)) {
      if (!reportedErrors.has(request.specifier)) {
        reportedErrors.add(request.specifier);
        findings.push({ ...request, why: `Node cannot import the package as an ES module (${namespace.error})` });
      }
      continue;
    }
    if (!namespace.includes(request.name)) {
      findings.push({
        ...request,
        why:
          `Node sees no named export "${request.name}" in this CommonJS package. ` +
          `A type: import type { ${request.name} }. A value: the default import (pkg.${request.name}).`,
      });
    }
  }
  return findings;
}

/** Named imports of packages that are still in each file's emitted JavaScript. */
export function collectEmittedNamedImports(
  project: Project,
  include: (file: SourceFile) => boolean,
): NamedImportRequest[] {
  const requests: NamedImportRequest[] = [];
  // Emit through the program the TS1272 pass already type-checked. `SourceFile#getEmitOutput`
  // goes through the language service, which builds and checks a second program: on a vendored
  // API of 1342 files that ran out of heap (review, 2026-10-26). Nothing is written to disk.
  const program = project.getProgram().compilerObject;
  for (const sourceFile of project.getSourceFiles()) {
    if (!include(sourceFile) || sourceFile.isDeclarationFile()) continue;
    let js: string | undefined;
    program.emit(sourceFile.compilerNode, (fileName, text) => {
      if (/\.[cm]?js$/.test(fileName)) js = text;
    });
    if (js === undefined) continue;
    for (const { name, specifier } of namedPackageImports(js)) {
      requests.push({ file: sourceFile.getFilePath(), line: sourceLine(sourceFile, specifier, name), name, specifier });
    }
  }
  return requests;
}

/** `import { a, b as c } from 'pkg'` in emitted JavaScript → [{ name: 'a' }, { name: 'b' }]. */
export function namedPackageImports(javascript: string): { name: string; specifier: string }[] {
  const file = ts.createSourceFile('emitted.js', javascript, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const imports: { name: string; specifier: string }[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imports.push({ name: (element.propertyName ?? element.name).text, specifier });
    }
  }
  return imports;
}

function importWithNode(projectDir: string, specifiers: string[]): Record<string, string[] | { error: string }> {
  const script = [
    'const out = {};',
    'for (const s of JSON.parse(process.env.LT_ESM_SPECIFIERS)) {',
    '  try { out[s] = Object.keys(await import(s)); }',
    '  catch (e) { out[s] = { error: e.code || String(e.message).split("\\n")[0] }; }',
    '}',
    'process.stdout.write(JSON.stringify(out));',
    'process.exit(0);',
  ].join('\n');
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, LT_ESM_SPECIFIERS: JSON.stringify(specifiers) },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  const output = (run.stdout || '').trim();
  try {
    return JSON.parse(output);
  } catch {
    const error = (run.stderr || run.error?.message || 'no output').split('\n')[0];
    return Object.fromEntries(specifiers.map((specifier) => [specifier, { error }]));
  }
}

/** Line of the source import that brings `name` from `specifier` (1 when it cannot be found). */
function sourceLine(sourceFile: SourceFile, specifier: string, name: string): number {
  const declaration = sourceFile
    .getImportDeclarations()
    .find(
      (candidate) =>
        candidate.getModuleSpecifierValue() === specifier &&
        candidate.getNamedImports().some((element) => element.getName() === name),
    );
  return declaration?.getStartLineNumber() ?? 1;
}
