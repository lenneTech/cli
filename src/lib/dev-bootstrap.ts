/**
 * Bootstrap-state checks that drive the mutual auto-chaining between
 * `lt dev install` (per-machine setup) and `lt dev init` (per-project
 * setup).
 *
 * These are pure, synchronous predicates so the chaining decision is
 * trivially testable and cannot itself trigger side effects. The actual
 * work is delegated to `runInstall` / `runMigrate`, which never call each
 * other — so the install↔init chaining can never recurse infinitely:
 *
 *   - `lt dev init`   → if NOT machine-prepared, run install first, then init
 *   - `lt dev install`→ if inside an un-initialized project, run init after
 *
 * Because each command calls the *helpers* (not the other command), the
 * chain is at most one hop deep in either direction. The predicates below
 * additionally make re-runs no-ops (nothing repeated unnecessarily).
 */
import { existsSync } from 'fs';

import { buildIdentity } from './dev-identity';
import { DevProjectLayout } from './dev-project';
import { getServicePaths } from './dev-service';
import { loadRegistry } from './dev-state';

/**
 * True if this path is an lt-dev-capable project — i.e. `resolveLayout`
 * found an API (`src/config.env.ts`) and/or App (`nuxt.config.ts`).
 * Used by `lt dev install` to decide whether an auto-init makes sense.
 */
export function isLtDevProject(layout: DevProjectLayout): boolean {
  return !!(layout.apiDir || layout.appDir);
}

/**
 * True once `lt dev install` has set up this machine — i.e. the
 * LaunchAgent/systemd unit file exists. This is the durable marker that
 * install has run; whether the daemon is currently *running* is a
 * separate concern handled by `lt dev up` / `doctor`.
 *
 * Always false on unsupported platforms (no service model), so the
 * chaining never tries to install where it cannot.
 */
export function isMachinePrepared(): boolean {
  const paths = getServicePaths();
  return paths.platform !== 'unsupported' && existsSync(paths.unitFile);
}

/**
 * True if this project is already registered with `lt dev` (present in
 * `~/.lenneTech/projects.json` under its slug, pointing at this root).
 * This is the durable marker that `lt dev init` has run for the project.
 */
export function isProjectInitialized(layout: DevProjectLayout): boolean {
  const slug = buildIdentity(layout.root).slug;
  const entry = loadRegistry().projects[slug];
  return !!entry && entry.path === layout.root;
}

/**
 * Pure decision: should `lt dev install` run `init` AFTERWARDS? Yes only
 * when not opted out, we're inside an lt-dev-capable project, and that
 * project isn't initialized yet. Re-runs become no-ops once initialized.
 */
export function shouldRunInitAfterInstall(input: {
  isProject: boolean;
  projectInitialized: boolean;
  skipInit: boolean;
}): boolean {
  return !input.skipInit && input.isProject && !input.projectInitialized;
}

/**
 * Pure decision: should `lt dev init` run `install` BEFORE initializing?
 * Yes only when not opted out, the platform supports a service model, and
 * the machine isn't prepared yet. Re-runs become no-ops once prepared.
 */
export function shouldRunInstallBeforeInit(input: {
  machinePrepared: boolean;
  platformSupported: boolean;
  skipInstall: boolean;
}): boolean {
  return !input.skipInstall && input.platformSupported && !input.machinePrepared;
}
