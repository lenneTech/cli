/**
 * Which framework mode (npm or vendor) a new frontend gets.
 *
 * One rule for `lt fullstack init` and `lt fullstack add-app`, so the default does
 * not depend on which of the two created the app (it used to: vendor in init, npm
 * in add-app). Precedence, highest first:
 *
 *   1. `--frontend-framework-mode`
 *   2. `--framework-mode` (workspace-wide; without this inheritance
 *      `--framework-mode npm` produced an npm API next to a vendored frontend)
 *   3. `commands.fullstack.frontendFrameworkMode`
 *   4. `commands.fullstack.frameworkMode`
 *   5. `vendor`
 *
 * The same for Nuxt (nuxt-extensions in `app/core/`) and Angular (ng-base in
 * `src/core/`).
 */

export type FrontendFrameworkModeChoice = 'npm' | 'vendor';

/** Result of {@link resolveFrontendFrameworkMode}. */
export interface FrontendFrameworkModeResolution {
  /** Set when `--frontend-framework-mode` carries an invalid value; `mode` is then meaningless. */
  error?: string;
  mode: FrontendFrameworkModeChoice;
  /** Where the mode came from, for the "Using …" line; `undefined` for the default. */
  source?: string;
}

export function resolveFrontendFrameworkMode(input: {
  cliFrameworkMode?: unknown;
  cliFrontendFrameworkMode?: unknown;
  configFrameworkMode?: unknown;
  configFrontendFrameworkMode?: unknown;
}): FrontendFrameworkModeResolution {
  const valid = (value: unknown): value is FrontendFrameworkModeChoice => value === 'npm' || value === 'vendor';
  const { cliFrameworkMode, cliFrontendFrameworkMode, configFrameworkMode, configFrontendFrameworkMode } = input;

  if (valid(cliFrontendFrameworkMode)) {
    return { mode: cliFrontendFrameworkMode, source: '--frontend-framework-mode' };
  }
  if (cliFrontendFrameworkMode !== undefined && cliFrontendFrameworkMode !== '') {
    return {
      error: `Invalid --frontend-framework-mode value "${String(cliFrontendFrameworkMode)}". Use "npm" or "vendor".`,
      mode: 'vendor',
    };
  }
  if (valid(cliFrameworkMode)) {
    return { mode: cliFrameworkMode, source: '--framework-mode' };
  }
  if (valid(configFrontendFrameworkMode)) {
    return { mode: configFrontendFrameworkMode, source: 'lt.config' };
  }
  if (valid(configFrameworkMode)) {
    return { mode: configFrameworkMode, source: 'lt.config frameworkMode' };
  }
  return { mode: 'vendor' };
}
