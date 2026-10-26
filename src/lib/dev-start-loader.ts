/**
 * Moves a vendored project's source runs (dev start, debug start, `docs:ci`) from ts-node to the
 * vendored core's own TypeScript loader.
 *
 * nest-server 12 writes every relative specifier in its core with an extension
 * (`./core.module.js`), so the core is valid as CommonJS and ESM. ts-node 10 cannot map `./x.js`
 * to `./x.ts`, with or without its experimental resolver. Measured 2026-10-26 on a 12 core vendored
 * into nest-server-starter 11.43.3: `ts-node -r tsconfig-paths/register src/main.ts` (the starter's
 * `nodemon.json`) dies with `Cannot find module './core.module.js'`, while build, `migrate:*`,
 * generators and the vitest suites stay green, because none of them goes through ts-node. With
 * `node -r ./src/core/modules/migrate/helpers/ts-compiler.js` the same server answers on
 * `/health-check`. The starter switches its own commands only after the 12.0.0 publish, so a
 * project vendored before that keeps ts-node unless the conversion rewrites it.
 *
 * npm mode is not affected: there the core is compiled JavaScript in `dist/`.
 */

/** The vendored core's loader, as a project command names it. */
export const VENDOR_CORE_LOADER = './src/core/modules/migrate/helpers/ts-compiler.js';

const TS_NODE_REGISTER = /^ts-node\/register(?:\/transpile-only)?$/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Rewrites every command in `command` (split on `&&`, `||` and `;`) that runs TypeScript through
 * ts-node:
 *
 * - `ts-node [-r X]… <entry> [args]` becomes `node -r <loader> [-r X]… <entry> [args]`;
 * - `node [opts] -r ts-node/register …` gets the loader in place of `ts-node/register`.
 *
 * A leading `cross-env` and `KEY=value` prefix is kept. A ts-node call with any other option
 * (`-T`, `--project`, `-O`, …) has no `node` equivalent: it is left untouched and listed in
 * `unconverted`, never guessed. Idempotent: the result names no ts-node any more.
 */
export function toCoreLoaderCommand(
  command: string,
  loader: string = VENDOR_CORE_LOADER,
): { command: string; unconverted: string[] } {
  const unconverted: string[] = [];
  const parts = command.split(/(\s*(?:&&|\|\||;)\s*)/);
  const converted = parts.map((part, index) => {
    if (index % 2 === 1) return part; // a separator
    const result = convertSegment(part, loader);
    if (result.unconverted) unconverted.push(part.trim());
    return result.text;
  });
  return { command: converted.join(''), unconverted };
}

/** One command of a script: rewrite it, or say why it stays. */
function convertSegment(segment: string, loader: string): { text: string; unconverted?: boolean } {
  const leading = /^\s*/.exec(segment)?.[0] ?? '';
  const trailing = /\s*$/.exec(segment)?.[0] ?? '';
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { text: segment };

  let start = 0;
  if (tokens[start] === 'cross-env') start++;
  while (start < tokens.length && ENV_ASSIGNMENT.test(tokens[start])) start++;
  const prefix = tokens.slice(0, start);
  const program = tokens[start];
  const rest = tokens.slice(start + 1);
  const rebuilt = (body: string[]) => `${leading}${[...prefix, ...body].join(' ')}${trailing}`;

  if (program === 'ts-node') {
    let i = 0;
    while (i < rest.length && rest[i].startsWith('-')) {
      if ((rest[i] === '-r' || rest[i] === '--require') && rest[i + 1] && !rest[i + 1].startsWith('-')) {
        i += 2;
        continue;
      }
      return { text: segment, unconverted: true };
    }
    // Without an entry file ts-node opens a REPL, which node -r cannot reproduce.
    if (i >= rest.length) return { text: segment, unconverted: true };
    return { text: rebuilt(['node', '-r', loader, ...rest]) };
  }

  if (program === 'node') {
    let changed = false;
    const body = rest.map((token, i) => {
      const previous = rest[i - 1];
      if ((previous === '-r' || previous === '--require') && TS_NODE_REGISTER.test(token)) {
        changed = true;
        return loader;
      }
      return token;
    });
    return changed ? { text: rebuilt(['node', ...body]) } : { text: segment };
  }

  return { text: segment };
}
