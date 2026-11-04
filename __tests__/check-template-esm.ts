/**
 * Run assertions against an ES module in a real Node ESM process.
 *
 * The check wrapper (`scripts/check.mjs` of an lt-monorepo release) is installed
 * verbatim into projects and executed there by plain `node`. A test transform
 * that rewrites `import()` would test a CommonJS rewrite rather than the file
 * the project runs. So the module under test is loaded by the same runtime that
 * runs it in production, and only the RESULT crosses back into the test.
 */
import { execFileSync } from 'child_process';

/**
 * Evaluate `body` as an ES module in a child `node` and return what it reports.
 *
 * `body` must call `report(value)` exactly once with a JSON-serialisable value.
 * Anything the module writes to stderr is surfaced in the thrown error, so a
 * failure inside the child is readable instead of appearing as an empty result.
 */
export function evalInNodeEsm<T>(body: string): T {
  const MARK = '';
  const script = `
const __out = [];
const report = (v) => { __out.push(v); };
${body}
process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(__out[0] ?? null) + ${JSON.stringify(MARK)});
`;
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    throw new Error(`node ESM child failed:\n${err.stderr || err.stdout || err.message}`);
  }
  // Delimited so incidental module output (a warning, a stray log) cannot be
  // mistaken for the payload.
  const match = stdout.match(/([\s\S]*)/);
  if (!match) {
    throw new Error(`no report() payload in child output:\n${stdout}`);
  }
  return JSON.parse(match[1]) as T;
}
