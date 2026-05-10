import { existsSync, readFileSync, writeFileSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { autoPatch, patchClaudeMd } from '../../lib/local-patches';
import { apiNeedsPortPatch, appNeedsPortPatch, resolveLayout } from '../../lib/local-project';
import { allocateSlot, loadRegistry, portsForSlot, projectSlug, saveRegistry } from '../../lib/port-registry';

/**
 * Register a port slot for the current project + optionally patch
 * legacy hardcoded ports.
 */
const InitCommand: GluegunCommand = {
  alias: ['i'],
  description: 'Register port slot',
  hidden: false,
  name: 'init',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, error, info, success, warning },
      prompt,
    } = toolbox;

    const layout = resolveLayout(filesystem.cwd(), filesystem);
    if (!layout.apiDir && !layout.appDir) {
      error('No API (src/config.env.ts) or App (nuxt.config.ts) project detected at this path.');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'local init: not a project';
    }

    const slug = projectSlug(layout.root);
    const registry = loadRegistry();

    // Determine slot: existing entry > CLI flag > deterministic from slug.
    let slot: number;
    const cliSlot = parameters.options.slot !== undefined ? Number(parameters.options.slot) : null;
    if (registry.projects[slug]) {
      slot = registry.projects[slug].slot;
      info(`Project "${slug}" already registered with slot ${slot}.`);
    } else if (cliSlot !== null && Number.isFinite(cliSlot)) {
      slot = cliSlot;
    } else {
      slot = allocateSlot(slug, registry);
    }
    const ports = portsForSlot(slot);

    info('');
    info(colors.bold('Project layout'));
    info(colors.dim('─'.repeat(50)));
    info(`  name:  ${slug}`);
    info(`  root:  ${layout.root}`);
    if (layout.apiDir) info(`  api:   ${layout.apiDir}`);
    if (layout.appDir) info(`  app:   ${layout.appDir}`);
    info(`  slot:  ${slot}`);
    info(`  ports: api=${ports.api}  app=${ports.app}`);

    // Detect legacy hardcoded ports
    const apiPatchFile = layout.apiDir ? apiNeedsPortPatch(layout.apiDir) : null;
    const appPatchFiles = layout.appDir ? appNeedsPortPatch(layout.appDir) : [];
    const filesToPatch = [apiPatchFile, ...appPatchFiles].filter((f): f is string => Boolean(f));

    const noConfirm = Boolean(parameters.options.noConfirm);
    const noPatch = Boolean(parameters.options.noPatch);
    const forcePatch = Boolean(parameters.options.patch);

    if (filesToPatch.length > 0 && !noPatch) {
      info('');
      warning('Files with legacy hardcoded ports detected:');
      filesToPatch.forEach((f) => info(`  - ${f}`));
      info(colors.dim('Patch makes them env-overridable: `process.env.PORT || 3000` etc. — defaults preserved.'));

      let doPatch = forcePatch;
      if (!doPatch && !noConfirm) {
        const ans = await prompt.confirm('Apply env-aware patches now?', true);
        doPatch = Boolean(ans);
      } else if (!doPatch && noConfirm) {
        info(colors.dim('Skipping patches (--noConfirm without --patch). Pass --patch to auto-apply.'));
      }
      if (doPatch) {
        for (const file of filesToPatch) {
          const result = autoPatch(file);
          if (result.patched) {
            success(`patched ${result.replacements}× in ${file}`);
          } else {
            info(colors.dim(`skipped (already patched): ${file}`));
          }
        }
      }
    } else if (filesToPatch.length === 0) {
      info(colors.dim('  patches: not needed (already env-aware)'));
    }

    // Persist to registry only when something actually changed — avoids
    // mtime churn on ~/.lenneTech/ports.json for cloud-sync tools (Dropbox,
    // iCloud Drive, Syncthing) and editor "file changed externally" prompts.
    const dbName = deriveDbName(layout, slug);
    const existing = registry.projects[slug];
    const next = { dbName, path: layout.root, ports, slot };
    const changed =
      !existing ||
      existing.path !== next.path ||
      existing.slot !== next.slot ||
      existing.dbName !== next.dbName ||
      existing.ports.api !== next.ports.api ||
      existing.ports.app !== next.ports.app;
    if (changed) {
      registry.projects[slug] = next;
      saveRegistry(registry);
    }

    // Add .lt-local/ to .gitignore (idempotent)
    addToGitignore(layout.root, '.lt-local/');

    // Patch CLAUDE.md files (workspace + each subproject) with the active
    // port block so future Claude Code sessions read the correct ports
    // even when the lt-dev plugin's hook is not active.
    const claudeMdCandidates = [
      join(layout.root, 'CLAUDE.md'),
      ...(layout.apiDir ? [join(layout.apiDir, 'CLAUDE.md')] : []),
      ...(layout.appDir ? [join(layout.appDir, 'CLAUDE.md')] : []),
    ];
    const claudePatches = claudeMdCandidates
      .map((file) => patchClaudeMd(file, { apiPort: ports.api, appPort: ports.app, dbName, slug }))
      .filter((r) => r.patched);
    if (claudePatches.length > 0) {
      claudePatches.forEach((r) => success(`updated CLAUDE.md port block: ${r.file}`));
    }

    info('');
    success(`Registered. Run \`lt local up\` to start.`);
    if (!parameters.options.fromGluegunMenu) process.exit();
    return `local init ${slug} slot=${slot}`;
  },
};

/** Append entry to .gitignore if not already present. */
function addToGitignore(root: string, entry: string): void {
  const path = join(root, '.gitignore');
  let content = '';
  if (existsSync(path)) content = readFileSync(path, 'utf8');
  const lines = content.split(/\r?\n/);
  if (lines.some((l) => l.trim() === entry || l.trim() === entry.replace(/\/$/, ''))) return;
  const ensured = `${(content.endsWith('\n') || content.length === 0 ? content : `${content}\n`) + entry}\n`;
  writeFileSync(path, ensured, 'utf8');
}

/** Derive a sensible default DB name from project + workspace shape. */
function deriveDbName(layout: ReturnType<typeof resolveLayout>, slug: string): string {
  // Reuse existing dbName from the API config if it is the default `${slug}-local`
  if (layout.apiDir) {
    const cfg = join(layout.apiDir, 'src', 'config.env.ts');
    if (existsSync(cfg)) {
      const content = readFileSync(cfg, 'utf8');
      const match = content.match(/dbName:\s*['"`]([^'"`]+)['"`]/);
      if (match) return match[1];
    }
  }
  return `${slug}-local`;
}

module.exports = InitCommand;
