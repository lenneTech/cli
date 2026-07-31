import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

/** What git can tell us about a file, and therefore whether an overwrite is recoverable. */
type GitRecoverability = 'dirty' | 'recoverable' | 'unknown';

/**
 * Idempotently repair a vendor-mode project's migration store
 * (`migrations-utils/migrate.js`).
 *
 * ## The defect this heals
 *
 * The store is generated ONCE, during `convertCloneToVendored()`. Projects that
 * were converted before the template learned its lesson keep the old file
 * forever: `migrations-utils/` is project scaffolding, not `src/core/`, so
 * neither the core updater nor any other update path ever touches it again.
 *
 * The old variant registers the ts-node bootstrap UNCONDITIONALLY:
 *
 * ```js
 * require('./ts-compiler');   // -> require('ts-node')
 * ```
 *
 * `ts-node` is a devDependency that the production Dockerfile prunes with
 * `pnpm install --prod`, while the image needs no transpiler at all (everything
 * next to the store is already compiled). So every deployed container dies with
 * `Cannot find module 'ts-node'` before applying a single migration.
 *
 * It stays invisible because `docker-entrypoint.sh` degrades a migration failure
 * to a warning on purpose — a bad migration must not crash-loop the container and
 * leave the orchestrator serving a stale build. The container reports healthy,
 * nothing is migrated, and nobody notices.
 *
 * ## Why the detection is inverted — the expensive lesson
 *
 * This function replaces the file WHOLESALE, and the replacement is not
 * behaviour-neutral: the bundled template hardcodes the collection name
 * (`'migrations'`) and takes its URI from `./mongo-uri`. A project that used a
 * different collection therefore gets an EMPTY migration ledger — and the next
 * `migrate:up` re-runs every historical migration against the live database. A
 * project that never had `./mongo-uri` crashes outright.
 *
 * The first implementation asked "can I SEE a guard?" and treated the answer
 * "no" as proof that none exists. It recognised exactly two shapes — a
 * `require.resolve` probe and a `try {` — so a perfectly production-safe
 * `if (!fs.existsSync(compiled)) require('./ts-compiler')` read as broken and
 * was destroyed, together with its collection name.
 *
 * So the question is inverted: heal ONLY when the hazard is positively proven,
 * i.e. the require sits as a TOP-LEVEL, unconditional statement — the one shape
 * that genuinely cannot survive a pruned image. Every other shape (inside `try`,
 * `if`, a function, a ternary, a block) is by construction conditional, hence
 * the project's own solution, and is left alone. "I did not recognise a guard"
 * is no longer evidence that there is none.
 *
 * Detection runs on the TypeScript AST, not on regex-stripped text. A regex
 * "lexer" has no string/template/regex-literal state, so a `/*` or `//` inside a
 * literal earlier in the file silently erased the guard and triggered the very
 * overwrite this function must avoid. `lib/strip-comments.ts` solves the comment
 * half properly (TS scanner) and would have been the right reuse; the AST solves
 * comments AND nesting in one step, and recognises a backtick require for free.
 *
 * ## Recoverability
 *
 * An overwrite is only acceptable when it can be undone. `git status --porcelain`
 * returning nothing does NOT mean "committed" — it also means untracked-and-
 * ignored, or not a git repo at all, i.e. exactly the cases where nothing can be
 * recovered. The guard therefore establishes tracked-ness directly
 * (`git ls-files --error-unmatch`) and writes a `.bak` whenever it cannot prove
 * git has a copy. A file with UNCOMMITTED modifications is never overwritten —
 * that would destroy work which exists nowhere else — and is reported as skipped.
 *
 * @param apiDir    Absolute path to the api project (the directory holding `src/core`).
 * @param assetPath Absolute path to the bundled `templates/vendor-scripts/migrate-store.js`.
 * @returns Changed paths relative to `apiDir`; empty when nothing needed healing.
 */
export function healVendorMigrateStore(apiDir: string, assetPath: string): string[] {
  const changed: string[] = [];

  // Vendor mode only. In npm mode the store requires the compiled
  // `@lenne.tech/nest-server` package and never needs a transpiler.
  if (!existsSync(join(apiDir, 'src', 'core', 'VENDOR.md'))) {
    return changed;
  }

  const rel = 'migrations-utils/migrate.js';
  const storePath = join(apiDir, 'migrations-utils', 'migrate.js');
  if (!existsSync(storePath) || !existsSync(assetPath)) {
    return changed;
  }

  // Never write THROUGH a symlink: the target may live anywhere, and the caller
  // asked us to repair a store, not to overwrite whatever it points at.
  if (isSymbolicLink(storePath)) {
    changed.push(`${rel} (skipped: is a symlink — repair the file it points at instead)`);
    return changed;
  }

  let current: string;
  try {
    current = readFileSync(storePath, 'utf8');
  } catch {
    return changed;
  }

  if (!hasTopLevelTsCompilerRequire(current)) {
    return changed;
  }

  const recoverability = gitRecoverability(apiDir, rel);
  if (recoverability === 'dirty') {
    changed.push(`${rel} (skipped: uncommitted changes — commit or discard them, then re-run)`);
    return changed;
  }

  let template: string;
  try {
    template = readFileSync(assetPath, 'utf8');
  } catch {
    return changed;
  }

  // No git copy to fall back on (untracked, ignored, or not a repo at all), so
  // leave one on disk before touching the file.
  let note = '';
  if (recoverability === 'unknown') {
    const backupPath = `${storePath}.bak`;
    try {
      if (!existsSync(backupPath)) {
        copyFileSync(storePath, backupPath);
      }
      note = ` — previous version saved to ${rel}.bak`;
    } catch {
      changed.push(`${rel} (skipped: git has no copy and the .bak could not be written)`);
      return changed;
    }
  }

  // Atomic: a crash between write and rename leaves the original intact rather
  // than a truncated store the migrate CLI would then fail to parse.
  if (!writeAtomic(storePath, template)) {
    changed.push(`${rel} (skipped: write failed)`);
    return changed;
  }

  changed.push(`${rel} (migrations never ran in deployed containers — see the file header)${note}`);

  return changed;
}

/**
 * Whether git holds a recoverable copy of `relPath`.
 *
 * - `recoverable` — tracked and unmodified: an overwrite is undoable via git.
 * - `dirty`       — tracked with uncommitted edits: must not be overwritten.
 * - `unknown`     — untracked, ignored, no repo, or no `git` on PATH. Git can
 *                   recover nothing here, so the caller must back up itself.
 *
 * Deliberately does NOT infer "committed" from empty `status --porcelain`
 * output: an ignored or untracked file is equally silent there, and treating
 * that silence as safety is what made the overwrite unrecoverable.
 */
function gitRecoverability(projectRoot: string, relPath: string): GitRecoverability {
  try {
    // Throws unless the path is TRACKED — the property we actually depend on.
    execFileSync('git', ['-C', projectRoot, 'ls-files', '--error-unmatch', '--', relPath], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    return 'unknown';
  }
  try {
    const out = execFileSync('git', ['-C', projectRoot, 'status', '--porcelain', '--', relPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0 ? 'dirty' : 'recoverable';
  } catch {
    return 'unknown';
  }
}

/**
 * True when the file requires the ts-node bootstrap as a TOP-LEVEL, unconditional
 * statement — the only shape that provably breaks in a production image where
 * ts-node has been pruned.
 *
 * Anything nested is conditional by construction and therefore the project's own
 * (working) solution — both of these are left alone, as is any other guard shape
 * someone invents:
 *
 * ```js
 * try { require.resolve(`${HELPER}.js`) } catch { require('./ts-compiler') }
 * if (!fs.existsSync(compiled)) { require('./ts-compiler') }
 * ```
 *
 * Uses the AST rather than text matching, so comments, string literals, template
 * literals and regex literals cannot fake — or hide — a match.
 */
function hasTopLevelTsCompilerRequire(source: string): boolean {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile('migrate.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  } catch {
    // Unparseable: we cannot prove the hazard, so we must not act.
    return false;
  }

  return sourceFile.statements.some((statement) => {
    if (!ts.isExpressionStatement(statement)) {
      return false;
    }
    return isTsCompilerRequireCall(statement.expression);
  });
}

/** True when `path` is a symlink (never follows it). */
function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** True for `require('./ts-compiler')` — single string or backtick argument. */
function isTsCompilerRequireCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'require') {
    return false;
  }
  if (node.arguments.length !== 1) {
    return false;
  }
  const arg = node.arguments[0];
  const isLiteral = ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg);
  return isLiteral && (arg as ts.StringLiteralLike).text === './ts-compiler';
}

/** Write via temp file + rename so a crash cannot leave a truncated store. */
function writeAtomic(target: string, content: string): boolean {
  const tmp = `${target}.lt-tmp`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, target);
    return true;
  } catch {
    try {
      if (existsSync(tmp)) {
        unlinkSync(tmp);
      }
    } catch {
      /* best effort */
    }
    return false;
  }
}
