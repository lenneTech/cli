/**
 * Reusable init/migrate logic — used by `commands/dev/init.ts` (interactive
 * + verbose, also chained from `commands/dev/install.ts`) and
 * `commands/fullstack/init.ts` (silent best-effort after project creation).
 *
 * Returns a structured result so callers can decide what to print.
 * Idempotent — safe to run multiple times.
 */
import { existsSync } from 'fs';
import { filesystem as gluegunFilesystem } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { buildIdentity, DevIdentity } from './dev-identity';
import { addToGitignore, autoPatch, patchClaudeMd, PatchResult } from './dev-patches';
import { deriveDbName, DevProjectLayout } from './dev-project';
import { loadRegistry, ProjectsRegistryEntry, saveRegistry } from './dev-state';
import { renameUnmodifiedTemplatePackage } from './package-name';

export interface MigrateInput {
  /** Resolved layout (from `resolveLayout`). */
  layout: DevProjectLayout;
}

export interface MigrateResult {
  /** True if the .gitignore was updated. */
  addedGitignoreEntry: boolean;
  /** True if the project was already fully migrated; false if anything changed. */
  alreadyMigrated: boolean;
  /** Patched CLAUDE.md files. */
  claudePatches: PatchResult[];
  /** Patched code files (config.env.ts/nuxt.config.ts/playwright.config.ts). */
  codePatches: PatchResult[];
  /** dbName resolved (from API config or default `<slug>-local`). */
  dbName: string;
  /** Project identity (slug + subdomains). */
  identity: DevIdentity;
  /** True if the registry was updated (new/changed). */
  registryUpdated: boolean;
  /**
   * Set to the new `name` field if the root package.json carried an
   * unmodified starter-template default (e.g. `lt-monorepo`) and was
   * rewritten to the directory basename. `null` when no rewrite happened.
   */
  renamedTemplatePackage: null | string;
}

/**
 * Print a `runMigrate` result via the toolbox. Shared by `lt dev init`
 * and the auto-init step of `lt dev install` so both render identically.
 * Does NOT print Caddy-install hints — chaining handles that separately.
 */
export function printMigrateResult(toolbox: ExtendedGluegunToolbox, result: MigrateResult): void {
  const {
    print: { colors, info, success },
  } = toolbox;

  info('');
  info(colors.bold(`Initializing "${result.identity.slug}" for lt dev`));
  info(colors.dim('─'.repeat(60)));
  if (result.identity.subdomains.app) info(`  App URL: https://${result.identity.subdomains.app.hostname}`);
  if (result.identity.subdomains.api) info(`  API URL: https://${result.identity.subdomains.api.hostname}`);
  info(`  DB:      mongodb://127.0.0.1/${result.dbName}`);
  info('');

  if (result.renamedTemplatePackage) {
    success(`renamed root package.json name → "${result.renamedTemplatePackage}" (was unmodified template default)`);
  }

  if (result.codePatches.length > 0) {
    for (const r of result.codePatches) {
      if (r.patched) success(`patched ${r.replacements}× in ${r.file}`);
      else info(colors.dim(`already patched: ${r.file}`));
    }
  } else {
    info(colors.dim('  patches: not needed (already env-aware)'));
  }

  result.claudePatches.filter((r) => r.patched).forEach((r) => success(`updated CLAUDE.md URL block: ${r.file}`));

  if (result.registryUpdated) {
    success(`registered in ${process.env.LT_DEV_REGISTRY_PATH || '~/.lenneTech/projects.json'}`);
  }

  if (result.addedGitignoreEntry) success('added `.lt-dev/` to .gitignore');

  if (result.alreadyMigrated) {
    info(colors.dim('  Project was already initialized — nothing changed.'));
  }
}

/**
 * Run all migration steps for a resolved project.
 *
 * Idempotent — re-running with no changes returns `alreadyMigrated: true`.
 */
export function runMigrate(input: MigrateInput): MigrateResult {
  const { layout } = input;

  // 0. If the root package.json still carries an unmodified starter-template
  //    name (e.g. `lt-monorepo` from a raw `git clone`), rewrite it to the
  //    directory basename before deriving identity. Otherwise every cloned
  //    project would slug to `lt-monorepo` and collide on
  //    `https://lt-monorepo.localhost`. `lt fullstack init` already handles
  //    this — the call here is the safety net for projects that bypassed
  //    init (e.g. manual `git clone lenneTech/lt-monorepo my-project`).
  const renamedTemplatePackage = renameUnmodifiedTemplatePackage({
    filesystem: gluegunFilesystem,
    projectRoot: layout.root,
  });

  const identity = buildIdentity(layout.root);
  const dbName = deriveDbName(layout.apiDir, identity.slug);

  // 1. Code patches. Run `autoPatch` over EVERY existing config file (not just
  //    the ones a port-detector flags): the patches are idempotent, and some —
  //    e.g. the playwright.config `ignoreHTTPSErrors` + shard-aware
  //    `LT_DEV_TEST_SHARDS` timeout block — apply to configs that are already
  //    env-aware. So `lt dev init` makes any project fully `lt dev test --shard`
  //    ready in one command; an up-to-date config is a no-op (`patched: false`).
  const filesToPatch: string[] = [];
  if (layout.apiDir) {
    const apiCfg = join(layout.apiDir, 'src', 'config.env.ts');
    if (existsSync(apiCfg)) filesToPatch.push(apiCfg);
  }
  if (layout.appDir) {
    for (const rel of ['nuxt.config.ts', 'playwright.config.ts']) {
      const f = join(layout.appDir, rel);
      if (existsSync(f)) filesToPatch.push(f);
    }
  }
  const codePatches = filesToPatch.map((f) => autoPatch(f));

  // 2. CLAUDE.md URL block (root + each subproject — only patches existing files).
  const claudeCandidates = [
    join(layout.root, 'CLAUDE.md'),
    ...(layout.apiDir ? [join(layout.apiDir, 'CLAUDE.md')] : []),
    ...(layout.appDir ? [join(layout.appDir, 'CLAUDE.md')] : []),
  ];
  const claudePatches = claudeCandidates
    .filter((f) => existsSync(f))
    .map((f) => patchClaudeMd(f, { dbName, identity }));

  // 3. Registry — only write when something actually changed.
  const reg = loadRegistry();
  const subdomainMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(identity.subdomains)) subdomainMap[k] = v.hostname;
  const existing = reg.projects[identity.slug];
  const next: ProjectsRegistryEntry = {
    dbName,
    internalPorts: existing?.internalPorts || {},
    lastUsedAt: existing?.lastUsedAt,
    path: layout.root,
    subdomains: subdomainMap,
  };
  const registryChanged =
    !existing ||
    existing.path !== next.path ||
    existing.dbName !== next.dbName ||
    JSON.stringify(existing.subdomains) !== JSON.stringify(next.subdomains);
  if (registryChanged) {
    reg.projects[identity.slug] = next;
    saveRegistry(reg);
  }

  // 4. .gitignore
  const addedGitignoreEntry = addToGitignore(layout.root, '.lt-dev/');

  const codePatched = codePatches.filter((r) => r.patched).length > 0;
  const claudePatched = claudePatches.filter((r) => r.patched).length > 0;
  const alreadyMigrated =
    !codePatched && !claudePatched && !registryChanged && !addedGitignoreEntry && !renamedTemplatePackage;

  return {
    addedGitignoreEntry,
    alreadyMigrated,
    claudePatches,
    codePatches,
    dbName,
    identity,
    registryUpdated: registryChanged,
    renamedTemplatePackage,
  };
}
