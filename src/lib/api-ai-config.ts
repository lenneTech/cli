/**
 * Whether an API configures nest-server's AI module.
 *
 * nest-server adds CoreAiModule, with all its /ai/* routes, as soon as the config has an `ai` block
 * ("presence implies enabled", core.module.ts), and its env merge turns `NSC__AI__ENCRYPTION_SECRET`
 * alone into such a block. A checklist that recommends the variable for every project therefore
 * switches the module on in every deployed stage of a project that never configured AI, while the
 * local start, without the variable, stays without it. Found in the smoke test of 12.8.6.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * True when `src/config.env.ts` of the API has an `ai` property that is not switched off (`false`, or
 * an object with `enabled: false`). Read from the AST, so a commented-out example never counts.
 * @param apiDir - The API project (`projects/api` in a workspace)
 */
export function apiConfiguresAi(apiDir: string): boolean {
  const file = join(apiDir, 'src', 'config.env.ts');
  if (!existsSync(file)) return false;
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return false;
  }

  // Lazy: gluegun loads every command module on every `lt` run, and TypeScript is large.
  const ts = require('typescript') as typeof import('typescript');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

  const nameOf = (name: import('typescript').PropertyName): null | string =>
    ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
  const switchedOff = (init: import('typescript').Expression): boolean => {
    if (init.kind === ts.SyntaxKind.FalseKeyword) return true;
    if (!ts.isObjectLiteralExpression(init)) return false;
    return init.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) && nameOf(p.name) === 'enabled' && p.initializer.kind === ts.SyntaxKind.FalseKeyword,
    );
  };

  let found = false;
  const visit = (node: import('typescript').Node): void => {
    if (found) return;
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'ai') found = true;
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === 'ai' && !switchedOff(node.initializer)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
