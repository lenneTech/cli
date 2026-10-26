// TypeScript loader for the migrate CLI (vendor mode). Loaded by migrations-utils/migrate.js
// when the vendored core is still TypeScript (repo layout), and by the
// `--compiler ts:./migrations-utils/ts-compiler.js` argument of the migrate:* scripts for the
// .ts migrations themselves. Requiring it registers the loader; the exported function does the
// same and is idempotent, which is the contract `--compiler ts:<file>` relies on.
//
// nest-server >= 12 ships its own loader in the vendored core
// (src/core/modules/migrate/helpers/ts-compiler.js, SWC instead of ts-node), which registers
// itself on require and marks its hook. This file uses it whenever the core provides it, so the
// project keeps working after a core update and once ts-node leaves its devDependencies. An older
// core has a file at the same path that only re-exports ts-node's `register`; for those, this
// file registers ts-node itself.
//
// The ts-node branch does NOT read the project's tsconfig.json (`skipProject`): it only has to
// strip types, and every option inherited from there can fail the load instead. `module:
// commonjs` on top of `moduleResolution: nodenext` is TS5110, a missing `rootDir` next to
// `outDir` is TS5011 under TypeScript 6, and transpile-only mode still reports option errors.
// Without a project config ts-node falls back to its bundled defaults, which set
// `moduleResolution: node`. TypeScript 6 rejects that (TS5107). `bundler` is the TypeScript 6
// default for CommonJS, but TypeScript 5 accepts it only together with ES module output, hence
// the version switch.
'use strict';

const Module = require('node:module');
const path = require('node:path');

const CORE_LOADER = path.join(__dirname, '..', 'src', 'core', 'modules', 'migrate', 'helpers', 'ts-compiler.js');
const CORE_LOADER_MARKER = Symbol.for('lenne.tech/nest-server/ts-compiler');

// `Module._extensions` is Node's table of require hooks, the one every loader patches.
const coreLoaderActive = () => Boolean(Module._extensions['.ts'] && Module._extensions['.ts'][CORE_LOADER_MARKER]);

function registerTsNode() {
  const tsNode = require('ts-node');
  const tsMajor = Number.parseInt(require('typescript').version, 10);
  tsNode.register({
    compilerOptions: {
      emitDecoratorMetadata: true,
      esModuleInterop: true,
      experimentalDecorators: true,
      module: 'commonjs',
      moduleResolution: tsMajor >= 6 ? 'bundler' : 'node',
      target: 'es2022',
    },
    skipProject: true,
    transpileOnly: true,
  });
}

let registered = false;

function register() {
  if (registered || coreLoaderActive()) {
    return;
  }
  let coreError;
  try {
    require(CORE_LOADER);
  } catch (error) {
    // No core loader at all, or an older one whose ts-node is missing.
    coreError = error;
  }
  if (!coreLoaderActive()) {
    try {
      registerTsNode();
    } catch (tsNodeError) {
      // The core loader's own instruction (`pnpm add -D @swc/core`) is the one that fixes a
      // nest-server >= 12 project; ts-node is missing there by design.
      throw coreError && coreError.code === 'LT_SWC_CORE_MISSING' ? coreError : tsNodeError;
    }
  }
  registered = true;
}

register();

module.exports = register;
