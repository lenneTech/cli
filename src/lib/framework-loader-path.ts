/**
 * nest-server >= 12 runs TypeScript sources through its own SWC loader instead of ts-node
 * (`core/modules/migrate/helpers/ts-compiler.js`, migration guide 11.43.x → 12.0.x §14). A
 * project points at it with `node -r <path>` in `nodemon.json`, `nodemon-debug.json` and
 * scripts such as `docs:ci`. The path differs per framework mode, and the file is plain
 * JavaScript in both trees, so it can be translated one to one:
 *
 * - npm mode:    `./node_modules/@lenne.tech/nest-server/dist/core/modules/migrate/helpers/ts-compiler.js`
 * - vendor mode: `./src/core/modules/migrate/helpers/ts-compiler.js`
 *
 * Left in npm form, a vendored project's dev start fails with `Cannot find module`, because
 * the package is not installed there; left in vendor form after `convert-mode --to npm`, it
 * points into the deleted `src/core/`.
 */

const LOADER_SUBPATH = 'core/modules/migrate/helpers/ts-compiler.js';
const NPM_LOADER = `node_modules/@lenne.tech/nest-server/dist/${LOADER_SUBPATH}`;
const VENDOR_LOADER = `src/${LOADER_SUBPATH}`;

/**
 * A path starts at a separator a command line or JSON string puts in front of it, so
 * `dist/src/core/…` (a compiled vendored tree) is never mistaken for the source loader.
 */
const BOUNDARY = `(^|[\\s"'=:])(\\./)?`;

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Rewrite the vendor-mode loader path back to the npm package path. */
export function toNpmLoaderPath(text: string): string {
  return text.replace(new RegExp(`${BOUNDARY}${escape(VENDOR_LOADER)}`, 'g'), `$1$2${NPM_LOADER}`);
}

/** Rewrite the npm package's loader path to the vendored core. */
export function toVendorLoaderPath(text: string): string {
  return text.replace(new RegExp(`${BOUNDARY}${escape(NPM_LOADER)}`, 'g'), `$1$2${VENDOR_LOADER}`);
}
