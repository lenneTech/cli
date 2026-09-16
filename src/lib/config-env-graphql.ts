/**
 * Guarantee `graphQl: false` in every environment block of a REST project's
 * `config.env.ts`.
 *
 * `CoreModule.forRoot` treats `options.graphQl === undefined` as ENABLED. A REST
 * conversion that removes the GraphQL scalars but leaves the switch absent therefore
 * produces a project that builds a GraphQL schema on boot and dies with
 * `Cannot determine a GraphQL output type for the "arguments"` — at start time, not at
 * generation time. Measured on Windows (2026-09-16) with a project from lt 1.47.0: the
 * `// #region graphql` block carrying `graphQl: { … }` was stripped and no replacement
 * was written, so the key was missing entirely.
 *
 * So the conversion no longer relies on a replacement having happened somewhere: it
 * ensures the switch afterwards, and refuses to hand over a project where it is still
 * missing.
 */
import type { ObjectLiteralExpression, SourceFile } from 'ts-morph';

/** Result of `disableGraphQlInEveryEnvBlock`. */
export interface DisableGraphQlResult {
  /** Names of the env blocks a `graphQl: false` was inserted into. */
  added: string[];
  /** The rewritten source (unchanged when nothing was missing). */
  content: string;
}

/**
 * Add `graphQl: false` to every environment block that has no `graphQl` property, and
 * replace a `graphQl: { … }` that survived with `false`.
 *
 * Line endings are preserved: a CRLF file stays CRLF.
 */
export function disableGraphQlInEveryEnvBlock(content: string): DisableGraphQlResult {
  const { project, sourceFile } = parse(content);
  const added: string[] = [];

  for (const [name, block] of envBlocks(sourceFile)) {
    const property = block.getProperty('graphQl');
    if (!property) {
      block.insertPropertyAssignment(0, { initializer: 'false', name: 'graphQl' });
      added.push(name);
      continue;
    }
    const initializer = (property as any).getInitializer?.();
    if (initializer && initializer.getText() !== 'false') {
      (property as any).setInitializer('false');
      added.push(name);
    }
  }

  const written = added.length > 0 ? sourceFile.getFullText() : content;
  project.removeSourceFile?.(sourceFile);
  return { added, content: restoreLineEndings(content, written) };
}

/**
 * Environment blocks that do NOT disable GraphQL — empty when the file is fine.
 * Used as the conversion's final check.
 */
export function envBlocksWithoutGraphQlDisabled(content: string): string[] {
  const { project, sourceFile } = parse(content);
  const offenders: string[] = [];

  for (const [name, block] of envBlocks(sourceFile)) {
    const property = block.getProperty('graphQl');
    const initializer = property && (property as any).getInitializer?.();
    if (!initializer || initializer.getText() !== 'false') {
      offenders.push(name);
    }
  }

  project.removeSourceFile?.(sourceFile);
  return offenders;
}

/**
 * True for a path that names `config.env.ts`, whatever the separator.
 *
 * `filesystem.find` returns `pathUtil.relative(cwd, path)`, which is
 * backslash-separated on Windows — an `endsWith('/config.env.ts')` check silently
 * matched nothing there, and `basename()` on a POSIX host cannot be tested for it.
 */
export function isConfigEnvFile(filePath: string): boolean {
  return filePath.split(/[\\/]/).pop() === 'config.env.ts';
}

/**
 * The environment blocks of a `config.env.ts`: the object-literal properties of the
 * exported `config` object, including the ones passed to a `merge(…)` call (the shape
 * the starter uses). Only direct children count — a nested `mongoose: { … }` is not an
 * environment.
 */
function envBlocks(sourceFile: SourceFile): [string, ObjectLiteralExpression][] {
  const { SyntaxKind } = require('ts-morph');
  const roots: ObjectLiteralExpression[] = [];

  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      if (declaration.getName() !== 'config') {
        continue;
      }
      const initializer = declaration.getInitializer();
      if (!initializer) {
        continue;
      }
      if (initializer.getKind() === SyntaxKind.ObjectLiteralExpression) {
        roots.push(initializer as ObjectLiteralExpression);
      }
      if (initializer.getKind() === SyntaxKind.CallExpression) {
        for (const argument of (initializer as any).getArguments()) {
          if (argument.getKind() === SyntaxKind.ObjectLiteralExpression) {
            roots.push(argument as ObjectLiteralExpression);
          }
        }
      }
    }
  }

  const blocks: [string, ObjectLiteralExpression][] = [];
  for (const root of roots) {
    for (const property of root.getProperties()) {
      if (property.getKind() !== SyntaxKind.PropertyAssignment) {
        continue;
      }
      const initializer = (property as any).getInitializer?.();
      if (initializer?.getKind() === SyntaxKind.ObjectLiteralExpression) {
        blocks.push([(property as any).getName(), initializer as ObjectLiteralExpression]);
      }
    }
  }
  return blocks;
}

function parse(content: string): { project: any; sourceFile: SourceFile } {
  const { Project } = require('ts-morph');
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  return { project, sourceFile: project.createSourceFile('config.env.ts', content, { overwrite: true }) };
}

/** ts-morph writes LF; a file that came in as CRLF goes back out as CRLF. */
function restoreLineEndings(original: string, written: string): string {
  if (!original.includes('\r\n')) {
    return written;
  }
  return written.replace(/\r?\n/g, '\r\n');
}
