import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

const COMMAND = join(__dirname, '..', 'src', 'commands', 'dev', 'test.ts');

/**
 * `lt dev test` (unsharded) must start its Playwright runner with the env from
 * `buildTestRunnerEnv`, which carries the test build dirs (`NG_OUTPUT_DIR`,
 * `NITRO_OUTPUT_DIR`, `NUXT_BUILD_DIR`).
 *
 * Until 1.58.7 the command built that env inline without them, so ng-base-starter's
 * `ssr-internal-api-url.spec.ts`, which starts the BUILT server itself, looked in
 * `.output/` and skipped — the check that no page carries the internal API address
 * never ran under `lt dev test`. The helper has its own tests in
 * `dev-test-session.test.ts`, but they cannot see the command: putting the 1.58.6
 * `test.ts` back left every one of them green. Running the real command would need
 * a whole test stack, so this guard reads the command's source instead, from the AST.
 */
function isTestE2eScript(node: ts.Node | undefined): boolean {
  return (
    !!node &&
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'runScript' &&
    !!node.arguments[0] &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments[0].text === 'test:e2e'
  );
}

/** The value of the property `name` in an object literal, `undefined` when absent or not a plain property. */
function propertyValue(object: ts.ObjectLiteralExpression, name: string): ts.Node | undefined {
  const prop = object.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === name);
  if (prop && ts.isShorthandPropertyAssignment(prop)) {
    return prop.name;
  }
  return prop && ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
}

/**
 * Why the env of the App runner, `runChildInherit(…, <pm>.runScript('test:e2e', …),
 * { cwd: <…>appDir, env })`, in `source` does not come from `buildTestRunnerEnv(…)`,
 * or `null` when it does. The `--api` runner (`cwd: layout.apiDir`) is out of scope:
 * it starts the API's own suite, which needs no test stack and keeps `process.env`.
 */
function runnerEnvProblem(source: string): null | string {
  const file = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true);

  const runs: ts.CallExpression[] = [];
  const findRuns = (node: ts.Node): void => {
    const options = ts.isCallExpression(node) ? node.arguments[2] : undefined;
    const cwd = options && ts.isObjectLiteralExpression(options) ? propertyValue(options, 'cwd') : undefined;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'runChildInherit' &&
      isTestE2eScript(node.arguments[1]) &&
      !!cwd &&
      /\bappDir$/.test(cwd.getText())
    ) {
      runs.push(node);
    }
    ts.forEachChild(node, findRuns);
  };
  findRuns(file);
  if (runs.length !== 1) {
    return `expected one App runner runChildInherit(…, runScript('test:e2e', …), { cwd: …appDir }), found ${runs.length}`;
  }
  const run = runs[0];
  const options = run.arguments[2] as ts.ObjectLiteralExpression;

  const envValue = propertyValue(options, 'env');
  const envName = envValue && ts.isIdentifier(envValue) ? envValue.text : undefined;
  if (!envName) {
    return 'the test:e2e runner env is not a variable built by buildTestRunnerEnv';
  }

  let scope: ts.Node = run;
  while (scope.parent && !ts.isFunctionLike(scope)) {
    scope = scope.parent;
  }

  let declaration: ts.VariableDeclaration | undefined;
  let reassigned = false;
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === envName &&
      node.getStart() < run.getStart()
    ) {
      declaration = node;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === envName
    ) {
      reassigned = true;
    }
    ts.forEachChild(node, collect);
  };
  collect(scope);

  const init = declaration?.initializer && unwrap(declaration.initializer);
  if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression)) {
    return `\`${envName}\` is not initialised by a buildTestRunnerEnv(…) call`;
  }
  if (init.expression.text !== 'buildTestRunnerEnv') {
    return `\`${envName}\` comes from ${init.expression.text}(…), not buildTestRunnerEnv(…)`;
  }
  if (reassigned) {
    return `\`${envName}\` is reassigned after buildTestRunnerEnv(…)`;
  }
  return null;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

const wrap = (body: string[]): string => ['async function run() {', ...body, '}'].join('\n');

const RUN_LINE =
  "  exitCode = await runChildInherit(appPm.bin, appPm.runScript('test:e2e', forwarded), { cwd: appDir, env });";

describe('lt dev test hands the unsharded runner the env of buildTestRunnerEnv', () => {
  it('src/commands/dev/test.ts builds the runner env with buildTestRunnerEnv', () => {
    expect(runnerEnvProblem(readFileSync(COMMAND, 'utf8'))).toBeNull();
  });

  it('reports the inline env of 1.58.6, which lacked the test build dirs', () => {
    const source = wrap([
      '  const env: NodeJS.ProcessEnv = {',
      '    ...process.env,',
      '    ...readBridgeEnv(layout.root),',
      "    MONGO_URI: 'mongodb://127.0.0.1/shop-test',",
      '  };',
      RUN_LINE,
    ]);
    expect(runnerEnvProblem(source)).toMatch(/not initialised by a buildTestRunnerEnv/);
  });

  it('reports an env built by the helper and then replaced', () => {
    const source = wrap([
      "  let env = buildTestRunnerEnv({ baseEnv: process.env, bridgeEnv: {}, dbName: 'shop-test' });",
      '  env = { ...process.env };',
      RUN_LINE,
    ]);
    expect(runnerEnvProblem(source)).toMatch(/reassigned/);
  });

  it('reports an env object written into the runner call itself', () => {
    const source = wrap([
      "  exitCode = await runChildInherit(appPm.bin, appPm.runScript('test:e2e', forwarded), { cwd: layout.appDir, env: { ...process.env } });",
    ]);
    expect(runnerEnvProblem(source)).toMatch(/not a variable/);
  });

  it('leaves the --api runner, which keeps process.env, alone', () => {
    const source = wrap([
      "  await runChildInherit(apiPm.bin, apiPm.runScript('test:e2e', forwarded), { cwd: layout.apiDir, env: process.env });",
      "  const env = buildTestRunnerEnv({ baseEnv: process.env, bridgeEnv: {}, dbName: 'shop-test' });",
      RUN_LINE,
    ]);
    expect(runnerEnvProblem(source)).toBeNull();
  });

  it('accepts debug flags set on the helper result', () => {
    const source = wrap([
      "  const env = buildTestRunnerEnv({ baseEnv: process.env, bridgeEnv: {}, dbName: 'shop-test' }) as NodeJS.ProcessEnv;",
      "  if (debug) { env.PWDEBUG = '1'; }",
      RUN_LINE,
    ]);
    expect(runnerEnvProblem(source)).toBeNull();
  });
});
