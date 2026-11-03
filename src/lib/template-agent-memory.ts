import { lstatSync, readdirSync, rmSync } from 'fs';
import { join, relative, sep } from 'path';

/** Directories that never hold a template's own agent memory and can be large. */
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);

/**
 * Remove every `.claude/agent-memory/` a template brought into a freshly
 * scaffolded project.
 *
 * The starters the CLI clones (`lt-monorepo`, `nest-server-starter`,
 * `nuxt-base-starter`, the latter also inside `nuxt-base-template/`) carried
 * their reviewer and maintainer agents' notes. Those notes describe the
 * TEMPLATE repository, not the project being created, and `lt fullstack init`
 * put them into the new project's initial commit. The base repos stopped
 * versioning them on 2026-11-01, but a clone of an older ref still has them,
 * and a local checkout used with `--*-copy` keeps them on disk as ignored files,
 * or as a symlink into the private notes repository (the lt-memory plugin),
 * which the copy reproduces as a symlink.
 *
 * Symlinks are never followed: a linked root, directory or `.claude` may lead
 * out of the project, and nothing outside it is ours to delete. A symlinked
 * `agent-memory` itself is removed as a link, its target stays.
 *
 * Call it on a CLONE or COPY only, never on a `--*-link` target: that is the
 * developer's own checkout.
 *
 * @returns the removed paths, relative to `root` with `/` separators
 */
export function removeTemplateAgentMemory(root: string): string[] {
  const removed: string[] = [];
  // `readdirSync` follows a linked root, which is exactly what must not happen.
  try {
    if (lstatSync(root).isSymbolicLink()) {
      return removed;
    }
  } catch {
    return removed;
  }

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED_DIRS.has(entry.name)) {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.name === '.claude') {
        const memory = join(path, 'agent-memory');
        if (lexists(memory)) {
          // `rmSync` unlinks a symlink instead of following it.
          rmSync(memory, { force: true, recursive: true });
          removed.push(relative(root, memory).split(sep).join('/'));
        }
      }
      walk(path);
    }
  };

  walk(root);
  return removed.sort();
}

/** `existsSync` without following a symlink, so a dangling link counts too. */
function lexists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
