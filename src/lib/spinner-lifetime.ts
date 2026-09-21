/**
 * Finds progress spinners that can be left running.
 *
 * gluegun's `spin(text)` is `require('ora')(text).start()`. ora 4.0.2 with the
 * default `discardStdin: true` does three things on start that only a stop undoes:
 * it puts the terminal into raw mode (remembering the value it found), it calls
 * `stdin.resume()` and adds a `data` listener, and it starts a `setInterval` for
 * the animation.
 *
 * A spinner that is never stopped therefore does not merely look untidy — the
 * interval and the resumed stdin keep the Node event loop alive, so the process
 * never exits, and the terminal stays in raw mode. That combination is how
 * `lt fullstack init` could reach the end of its work and simply not return, with
 * a spinner still turning. `failRun` deliberately sets `process.exitCode` instead
 * of calling `process.exit()` (so a failure message is never truncated), which
 * means "the event loop drains" is a precondition the CLI relies on.
 *
 * ## What "stopped" means here
 *
 * This is a dominance approximation, not a full control-flow analysis, and it is
 * deliberately conservative in the direction that avoids false alarms — a guard
 * that flags correct code gets switched off. A statement list definitely stops a
 * spinner when it contains a direct stop call, or an `if` whose BOTH branches
 * stop, or a `try` whose body and `catch` both stop (or whose `finally` stops).
 * Anything else does not count.
 *
 * Two questions are asked per spinner:
 *
 * 1. Can the end of its enclosing block be reached without a stop? That is the
 *    silent case — the command falls off the end, exit code 0, spinner running.
 * 2. Is there a `return` after it that no stop dominates? That is the early-exit
 *    case — an error path that prints and leaves.
 *
 * Returns inside a nested function are ignored: they leave the callback, not the
 * command.
 */
import * as ts from 'typescript';

/** Methods that stop an ora spinner. `stopAndPersist` is what `succeed`/`fail`/… call. */
const STOP_METHODS = new Set(['fail', 'info', 'stop', 'stopAndPersist', 'succeed', 'warn']);

export interface SpinnerLeak {
  /** 1-based line of the offending `return`, or of the declaration for `falls-through`. */
  line: number;
  reason: 'falls-through' | 'never-stopped' | 'return-without-stop';
  spinner: string;
}

/**
 * Every spinner in `source` that can outlive the code path that started it.
 *
 * @param source The file's text.
 * @param fileName Only used to pick the parser dialect.
 */
export function findSpinnerLeaks(source: string, fileName = 'file.ts'): SpinnerLeak[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const leaks: SpinnerLeak[] = [];
  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  for (const declaration of spinnerDeclarations(sourceFile)) {
    const name = declaration.name.getText(sourceFile);
    const block = enclosingBlock(declaration);
    if (!block) {
      continue;
    }

    const returns = returnsAfter(block, declaration);

    // `return spinner;` hands ownership to the caller, which is then responsible
    // for stopping it — a factory like `logger.ts#spin` is not a leak. One such
    // return exempts the whole declaration, because the spinner's lifetime is no
    // longer decided in this function.
    if (returns.some((statement) => handsOverOwnership(statement, name))) {
      continue;
    }

    const after = statementsAfter(block, declaration);
    if (!after.some((statement) => definitelyStops(statement, name, sourceFile))) {
      leaks.push({
        line: lineOf(declaration),
        reason: after.length === 0 ? 'never-stopped' : 'falls-through',
        spinner: name,
      });
    }

    for (const returnStatement of returns) {
      if (!dominatedByStop(returnStatement, block, declaration, name, sourceFile)) {
        leaks.push({ line: lineOf(returnStatement), reason: 'return-without-stop', spinner: name });
      }
    }
  }

  return leaks.sort((a, b) => a.line - b.line);
}

/**
 * True when executing `statement` always stops `name`.
 *
 * Only the shapes the CLI actually uses are recognised. Everything unrecognised
 * answers false, so an unusual construct produces a finding to look at rather
 * than a silent pass.
 */
function definitelyStops(statement: ts.Node, name: string, sourceFile: ts.SourceFile): boolean {
  if (ts.isExpressionStatement(statement)) {
    return isStopCall(statement.expression, name, sourceFile);
  }
  if (ts.isBlock(statement)) {
    return statement.statements.some((child) => definitelyStops(child, name, sourceFile));
  }
  if (ts.isIfStatement(statement)) {
    // Only an if/else that stops on BOTH sides stops unconditionally.
    return (
      !!statement.elseStatement &&
      definitelyStops(statement.thenStatement, name, sourceFile) &&
      definitelyStops(statement.elseStatement, name, sourceFile)
    );
  }
  if (ts.isTryStatement(statement)) {
    if (statement.finallyBlock && definitelyStops(statement.finallyBlock, name, sourceFile)) {
      return true;
    }
    return (
      definitelyStops(statement.tryBlock, name, sourceFile) &&
      !!statement.catchClause &&
      definitelyStops(statement.catchClause.block, name, sourceFile)
    );
  }
  return false;
}

/**
 * True when some stop of `name` is guaranteed to run before `returnStatement`.
 *
 * Walks out from the return towards `block`, and at each level checks the
 * statements that precede the one we came from — a stop in any of them dominates.
 */
function dominatedByStop(
  returnStatement: ts.Node,
  block: ts.Block,
  declaration: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
): boolean {
  let child: ts.Node = returnStatement;
  let parent: ts.Node | undefined = returnStatement.parent;

  while (parent) {
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      for (const statement of parent.statements) {
        if (statement === child || statement.getStart(sourceFile) >= child.getStart(sourceFile)) {
          break;
        }
        if (
          statement.getStart(sourceFile) > declaration.getStart(sourceFile) &&
          definitelyStops(statement, name, sourceFile)
        ) {
          return true;
        }
      }
    }
    if (parent === block) {
      return false;
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
}

/** The nearest enclosing block of a declaration — the scope its spinner must not outlive. */
function enclosingBlock(node: ts.Node): ts.Block | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isBlock(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

/** True for `return spinner;` — the caller becomes responsible for stopping it. */
function handsOverOwnership(statement: ts.ReturnStatement, name: string): boolean {
  return !!statement.expression && ts.isIdentifier(statement.expression) && statement.expression.text === name;
}

/** True for `x.succeed(…)` / `x.fail(…)` / … on the spinner called `name`. */
function isStopCall(expression: ts.Node, name: string, sourceFile: ts.SourceFile): boolean {
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
    return false;
  }
  const access = expression.expression;
  return access.expression.getText(sourceFile) === name && STOP_METHODS.has(access.name.text);
}

/** Every `return` after `declaration` inside `block`, skipping nested functions. */
function returnsAfter(block: ts.Block, declaration: ts.Node): ts.ReturnStatement[] {
  const found: ts.ReturnStatement[] = [];
  const start = declaration.getStart();

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      return; // A return there leaves the callback, not the command.
    }
    if (ts.isReturnStatement(node) && node.getStart() > start) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };

  for (const statement of block.statements) {
    if (statement.getStart() > start) {
      visit(statement);
    }
  }
  return found;
}

/** `const x = spin(…)` declarations, including `toolbox.print.spin(…)`. */
function spinnerDeclarations(sourceFile: ts.SourceFile): ts.VariableDeclaration[] {
  const found: ts.VariableDeclaration[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callee = node.initializer.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : '';
      if (name === 'spin') {
        found.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

/** The statements of `block` that follow `declaration`. */
function statementsAfter(block: ts.Block, declaration: ts.Node): ts.Statement[] {
  const start = declaration.getStart();
  return block.statements.filter((statement) => statement.getStart() > start);
}
