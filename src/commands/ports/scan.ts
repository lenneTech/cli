import { existsSync, lstatSync, readdirSync, readFileSync, type Stats } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { allocateSlot, loadRegistry, portsForSlot, projectSlug, saveRegistry } from '../../lib/port-registry';

/**
 * Rebuild the port registry from the filesystem.
 *
 * Walks the given directory (default: cwd) up to depth 3, looking for
 * `lt.config.json` + `package.json` pairs or workspace markers. Re-allocates
 * a slot for each new project found; preserves slots for projects whose
 * names already exist in the registry.
 */
const ScanCommand: GluegunCommand = {
  alias: [],
  description: 'Rebuild port registry',
  hidden: false,
  name: 'scan',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, info, success },
    } = toolbox;

    const startDir = parameters.first ? filesystem.path(parameters.first) : filesystem.cwd();
    info('');
    info(colors.bold(`Scanning for projects under ${startDir} ...`));

    const found = walkForProjects(startDir, 0, 3);
    info(colors.dim(`Found ${found.length} candidate project(s)`));

    const registry = loadRegistry();
    let added = 0;
    let kept = 0;
    let dirty = false;

    for (const project of found) {
      const slug = projectSlug(project.path);
      const existing = registry.projects[slug];
      if (existing) {
        if (existing.path !== project.path) {
          existing.path = project.path;
          dirty = true;
        }
        kept++;
        continue;
      }
      const slot = allocateSlot(slug, registry);
      registry.projects[slug] = { path: project.path, ports: portsForSlot(slot), slot };
      added++;
      dirty = true;
    }

    if (dirty) saveRegistry(registry);
    success(`Registry updated: ${added} new, ${kept} kept (total: ${Object.keys(registry.projects).length})`);

    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `ports scan: ${added} new`;
  },
};

interface FoundProject {
  path: string;
}

/** A directory looks like a project if it has `package.json` with a non-empty `name` field. */
function looksLikeProject(dir: string): boolean {
  if (!existsSync(join(dir, 'package.json'))) return false;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return Boolean(pkg.name);
  } catch {
    return false;
  }
}

/**
 * Recursive project discovery.
 *
 * Stops descending into a directory as soon as a project marker is detected
 * (lt.config.json with package.json, pnpm-workspace.yaml, or `projects/`).
 * Skips dotdirs and `node_modules`. Skips symlinks (lstatSync) to avoid
 * traversal loops on pathological filesystems.
 */
function walkForProjects(dir: string, depth: number, maxDepth: number): FoundProject[] {
  if (depth > maxDepth) return [];
  if (!existsSync(dir)) return [];
  const out: FoundProject[] = [];

  // A project is detected if EITHER an lt.config.json exists OR a workspace marker is found.
  if (existsSync(join(dir, 'lt.config.json'))) {
    if (looksLikeProject(dir)) {
      out.push({ path: dir });
      return out; // don't recurse into a detected project
    }
  }
  if (existsSync(join(dir, 'pnpm-workspace.yaml')) || existsSync(join(dir, 'projects'))) {
    out.push({ path: dir });
    return out;
  }

  let entries: { isDirectory(): boolean; isSymbolicLink(): boolean; name: string }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    // Use the cheap Dirent check first — it doesn't need an extra syscall.
    if (!entry.isDirectory()) {
      // Could still be a symlink that points to a directory. Skip those to
      // avoid traversal loops.
      if (!entry.isSymbolicLink()) continue;
      let s: Stats;
      try {
        s = lstatSync(join(dir, entry.name));
      } catch {
        continue;
      }
      if (s.isSymbolicLink()) continue;
    }
    out.push(...walkForProjects(join(dir, entry.name), depth + 1, maxDepth));
  }
  return out;
}

module.exports = ScanCommand;
