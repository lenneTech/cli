import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * Mark the current command run as failed.
 *
 * A gluegun command signals failure by printing and returning, and a bare
 * `return` leaves the process at exit code 0. So a scaffold that died halfway
 * reported SUCCESS to every caller that checks `$?` — a CI job, a wrapper
 * script, an agent. That is not theoretical: a `lt fullstack init` whose
 * `pnpm install` aborted on a native build script printed a red spinner and
 * still exited 0, and the half-built workspace was only noticed later, by hand.
 *
 * Call it immediately before every `return` on an error path:
 *
 *     failRun(toolbox);
 *     return;
 *
 * **`process.exitCode`, not `process.exit()`** — the latter can truncate
 * buffered output, including the spinner's own failure message, which is the one
 * line the operator actually needs.
 *
 * **Guarded by `fromGluegunMenu`**, like the CLI's other exit-code call sites
 * (`dev test`, `dev tunnel`, `tools ocr`, `workspace-integration`): inside the
 * interactive `lt` menu a command is one step of a longer session, and failing
 * the whole session because one step errored is the same over-reach in reverse.
 *
 * Shared rather than redeclared per command: `fullstack init` delegates to
 * `add-api` / `add-app` inside an existing workspace, so all three have to agree
 * on the contract or the exit code depends on which directory the user happened
 * to be standing in — which was exactly the state before this helper existed.
 */
export function failRun(toolbox: ExtendedGluegunToolbox): void {
  if (!toolbox.parameters?.options?.fromGluegunMenu) {
    process.exitCode = 1;
  }
}
