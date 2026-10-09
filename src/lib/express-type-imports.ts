/**
 * Marks the TYPE names in a vendored file's `express` imports as type-only.
 *
 * Why it exists: express exports `Request`, `Response`, `NextFunction` & co. as types
 * only. The npm-mode framework shipped compiled, so those imports were erased before
 * runtime; vendor mode runs the TypeScript source through vitest/vite, which keeps a
 * plain `import { Request } from 'express'` and fails with
 * "The requested module 'express' does not provide an export named 'Request'".
 *
 * Why it does not simply rewrite the whole import to `import type`: express also has
 * runtime exports, and the vendored core imports some of them as values —
 * `core-body-parser.initializer.ts` (nest-server 11.42.4+) calls `json()` and
 * `urlencoded()`. A blanket `import type { json, urlencoded }` broke the build of every
 * generated vendor-mode project with TS1361. So only names that are NOT runtime exports
 * become type-only; a mixed import keeps its values and gets inline `type` modifiers.
 */

/**
 * The runtime (value) exports of express — `lib/express.js`, v4 and v5. Everything
 * else a TypeScript file can import from 'express' only exists in its type declarations.
 */
const EXPRESS_VALUE_EXPORTS = new Set([
  'application',
  'json',
  'query',
  'raw',
  'request',
  'response',
  'Route',
  'Router',
  'static',
  'text',
  'urlencoded',
]);

// `[ \t]*`, not `\s*`, after the module name: `\s*$` under the `m` flag also swallowed
// the line break, and with it the blank line that usually follows the imports.
const EXPRESS_NAMED_IMPORT = /^import\s+\{([^}]*)\}\s+from\s+['"]express['"][ \t]*;?[ \t]*$/gm;

/** Rewrites every `import { … } from 'express'` in `content`; returns it unchanged when nothing applies. */
export function rewriteExpressImportsToTypeOnly(content: string): string {
  return content.replace(EXPRESS_NAMED_IMPORT, (_match, names: string) => {
    const specifiers = names
      .split(',')
      .map((n) => n.trim().replace(/^type\s+/, ''))
      .filter((n) => n.length > 0);
    const isValue = (specifier: string) => EXPRESS_VALUE_EXPORTS.has(specifier.split(/\s+as\s+/)[0].trim());

    if (!specifiers.some(isValue)) {
      return `import type { ${specifiers.join(', ')} } from 'express';`;
    }
    const marked = specifiers.map((s) => (isValue(s) ? s : `type ${s}`));
    return `import { ${marked.join(', ')} } from 'express';`;
  });
}
