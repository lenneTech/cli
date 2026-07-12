/**
 * Rewrite the hardcoded localhost URLs in an Angular app's environment files
 * to the deployed TurboOps stage URLs.
 *
 * WHY: a Nuxt app reads its API URL from the stage env at runtime
 * (`NUXT_PUBLIC_API_URL`, injected by TurboOps). Angular has no such runtime
 * config — `ng build --configuration production` BAKES `environment.prod.ts`
 * into the bundle. Without this patch a deployed Angular app ships
 * `apiUrl: 'http://127.0.0.1:3000/graphql'` and calls the end user's own
 * machine.
 *
 * Stage mapping (TurboOps knows exactly two stages, `dev` and `production`):
 *
 *   environment.prod.ts     → production → <domain>     + api.<domain>
 *   environment.develop.ts  → dev        → dev.<domain> + api.dev.<domain>
 *   environment.test.ts     → dev        → dev.<domain> + api.dev.<domain>
 *
 * `environment.ts` is the local-dev config and is deliberately left alone.
 * `environment.test.ts` and `environment.develop.ts` are identical in
 * ng-base-starter (both `prefix: 'app-test'`); with no TurboOps "test" stage,
 * the non-production stage is `dev` for both.
 *
 * Only the URL ORIGIN (scheme + host + optional port) is replaced — the path
 * (`/graphql`, `/api`) is preserved, so a project that customised it keeps its
 * routes. That also makes the patch idempotent AND re-runnable with a new
 * domain: an already-deployed URL is rewritten to the new one instead of being
 * skipped (the old `http://127.0.0.1:3000`-only replace silently did nothing
 * on the second run).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { PatchResult } from './dev-patches';

/**
 * A {@link PatchResult} plus whether a rewritable URL property was present.
 *
 * `patched: false` alone is ambiguous — it means both "already correct" and
 * "no URL to rewrite was found". `recognized` disambiguates: it is true when at
 * least one of `apiUrl`/`restUrl`/`wsUrl`/`appUrl` matched, whether or not the
 * value changed. The caller uses it to tell "already deployed" apart from "this
 * file has no URL we understand — warn the user" instead of reporting success.
 */
export interface AngularEnvPatchResult extends PatchResult {
  recognized: boolean;
}

/** The two stages a TurboOps project ships (see `.gitlab-ci.yml`). */
export type TurboOpsStage = 'dev' | 'production';

/** Which environment file belongs to which TurboOps stage. */
const ENVIRONMENT_STAGES: Record<string, TurboOpsStage> = {
  'environment.develop.ts': 'dev',
  'environment.prod.ts': 'production',
  'environment.test.ts': 'dev',
};

/**
 * Locate the Angular `environments/` directory for a project root.
 * Returns null for non-Angular apps (e.g. Nuxt), which makes the whole
 * patch a no-op there.
 */
export function findAngularEnvironmentsDir(projectRoot: string): null | string {
  const candidates = [join('projects', 'app', 'src', 'environments'), join('src', 'environments')];
  for (const rel of candidates) {
    const dir = join(projectRoot, rel);
    if (existsSync(dir)) return dir;
  }
  return null;
}

/**
 * Point every stage-specific Angular environment file at the deployed URLs.
 * Returns one {@link PatchResult} per file that exists (empty array when the
 * project is not an Angular app).
 */
export function patchAngularEnvironments(options: { domain: string; projectRoot: string }): AngularEnvPatchResult[] {
  const dir = findAngularEnvironmentsDir(options.projectRoot);
  if (!dir) return [];

  const results: AngularEnvPatchResult[] = [];
  for (const [fileName, stage] of Object.entries(ENVIRONMENT_STAGES)) {
    const file = join(dir, fileName);
    if (!existsSync(file)) continue;
    results.push(patchEnvironmentFile(file, options.domain, stage));
  }
  return results;
}

/**
 * Public hostnames of a stage. The API always lives one label in front of the
 * app host, so `dev` nests as `api.dev.<domain>`.
 */
export function stageHosts(domain: string, stage: TurboOpsStage): { api: string; app: string } {
  const app = stage === 'production' ? domain : `dev.${domain}`;
  return { api: `api.${app}`, app };
}

/** Rewrite the four URL properties of a single environment file. */
function patchEnvironmentFile(file: string, domain: string, stage: TurboOpsStage): AngularEnvPatchResult {
  const hosts = stageHosts(domain, stage);
  const original = readFileSync(file, 'utf8');
  let content = original;
  let replacements = 0;
  let recognized = 0;

  const rewriteOrigin = (property: string, origin: string): void => {
    // (property: )(quote)scheme://host[:port](path)(same quote)
    const pattern = new RegExp(`(${property}:\\s*)(['"])[a-z]+://[^'"/]+([^'"]*)\\2`, 'g');
    content = content.replace(pattern, (match, prefix: string, quote: string, path: string) => {
      recognized++;
      const next = `${prefix}${quote}${origin}${path}${quote}`;
      if (next !== match) replacements++;
      return next;
    });
  };

  rewriteOrigin('apiUrl', `https://${hosts.api}`);
  rewriteOrigin('restUrl', `https://${hosts.api}`);
  rewriteOrigin('wsUrl', `wss://${hosts.api}`);
  rewriteOrigin('appUrl', `https://${hosts.app}`);

  if (replacements > 0) writeFileSync(file, content, 'utf8');
  return { file, patched: replacements > 0, recognized: recognized > 0, replacements };
}
