/**
 * Reusable migrate logic — used by `commands/dev/migrate.ts` (interactive
 * + verbose) and `commands/fullstack/init.ts` (silent best-effort after
 * project creation).
 *
 * Returns a structured result so callers can decide what to print.
 * Idempotent — safe to run multiple times.
 */
import { existsSync } from 'fs';
import { join } from 'path';

import { buildIdentity, DevIdentity } from './dev-identity';
import { addToGitignore, autoPatch, patchClaudeMd, PatchResult } from './dev-patches';
import { apiNeedsPortPatch, appNeedsPortPatch, deriveDbName, DevProjectLayout } from './dev-project';
import { loadRegistry, ProjectsRegistryEntry, saveRegistry } from './dev-state';

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
}

/**
 * Run all migration steps for a resolved project.
 *
 * Idempotent — re-running with no changes returns `alreadyMigrated: true`.
 */
export function runMigrate(input: MigrateInput): MigrateResult {
  const { layout } = input;
  const identity = buildIdentity(layout.root);
  const dbName = deriveDbName(layout.apiDir, identity.slug);

  // 1. Code patches (config.env.ts, nuxt.config.ts, playwright.config.ts).
  const filesToPatch: string[] = [];
  if (layout.apiDir) {
    const f = apiNeedsPortPatch(layout.apiDir);
    if (f) filesToPatch.push(f);
  }
  if (layout.appDir) filesToPatch.push(...appNeedsPortPatch(layout.appDir));
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
  const alreadyMigrated = !codePatched && !claudePatched && !registryChanged && !addedGitignoreEntry;

  return {
    addedGitignoreEntry,
    alreadyMigrated,
    claudePatches,
    codePatches,
    dbName,
    identity,
    registryUpdated: registryChanged,
  };
}
