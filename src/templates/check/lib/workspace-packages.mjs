/**
 * One reader for `pnpm-workspace.yaml`'s `packages:` list, shared by every guard
 * that needs to know which directories are workspace members.
 *
 * There were three copies of this parse — `check.mjs`, `check-workspace-consistency.mjs`
 * and (newest, and the weakest of the three) `check-ci-consistency.mjs`. They had already
 * drifted: the two older ones stripped comments and tolerated a list whose dashes sit at
 * column 0, the newest handled neither. Three parsers of one format do not stay equal, and
 * the guards built on them fail in the direction that is hardest to notice — silently
 * resolving nothing and then reporting that every rule holds.
 *
 * Deliberately still a line reader rather than a YAML dependency: these scripts run before
 * `pnpm install` has necessarily succeeded, so they may not import anything.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The raw `packages:` globs, in file order. `[]` when the file is absent, unreadable,
 * or declares no `packages:` key — every caller treats "no globs" as "nothing to check",
 * which is why the callers that can must SAY so rather than pass quietly.
 *
 * Accepts the three spellings pnpm accepts, because a workspace that is valid to pnpm and
 * invisible to the guard is the worst of the two failure modes:
 *
 *   packages:            packages:           packages: ['projects/*']
 *     - 'projects/*'     - 'projects/*'
 *
 * The middle one — a block sequence indented to column 0 — is valid YAML and common, and
 * is what the newest copy of this parser silently dropped: it treated the dash line as the
 * next top-level key and stopped before reading anything.
 */
export function workspaceGlobs(root) {
  let text;
  try {
    text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return [];
  }

  const globs = [];
  let inside = false;
  for (const raw of text.split('\n')) {
    // Globs never contain `#`, so a naive strip is safe here and keeps both a whole
    // comment line and a trailing one (`packages: # the members`) from being read as
    // content — or, worse, as the end of the list.
    const line = raw.replace(/#.*$/, '');

    if (/^packages:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    // Flow style is a complete list on one line; there is no block to walk after it.
    const flow = /^packages:\s*\[(.*)\]\s*$/.exec(line);
    if (flow) {
      for (const item of flow[1].split(',')) {
        const value = item.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
        if (value) globs.push(value);
      }
      return globs;
    }
    if (!inside) continue;

    const entry = /^\s*-\s*['"]?([^'"\s]+)/.exec(line);
    if (entry) {
      globs.push(entry[1]);
      continue;
    }
    // A non-empty line that is neither an entry nor indented is the next top-level key.
    // Checked only AFTER the entry match, so a column-0 dash counts as list content.
    if (line.trim() && !/^\s/.test(line)) break;
  }
  return globs;
}

/**
 * The directories one glob expands to, relative to `root` and always `/`-separated.
 *
 * Handles the two shapes lt workspaces use — `dir/*` and a literal path. Anything else
 * (`**`, a mid-path star, a negation) expands to nothing rather than to a guess.
 *
 * Symlinked members count. `lt fullstack init --api-link` / `--frontend-link` make
 * `projects/api` / `projects/app` symlinks into the developer's own checkout of the
 * starter, and `Dirent.isDirectory()` reflects an lstat — it is FALSE for a symlink.
 * Filtering on it alone made every link-mode workspace look empty, so all three guards
 * resolved zero packages and reported that everything held.
 */
export function expandGlob(root, glob) {
  const base = /^([^*]+)\/\*$/.exec(glob)?.[1];
  if (!base) {
    // A literal path is a member if it is there; a glob shape we do not model is not.
    if (glob.includes('*')) return [];
    return isDirectory(join(root, glob)) ? [glob] : [];
  }

  let entries;
  try {
    entries = readdirSync(join(root, base), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      out.push(`${base}/${entry.name}`);
    } else if (entry.isSymbolicLink() && isDirectory(join(root, base, entry.name))) {
      out.push(`${base}/${entry.name}`);
    }
  }
  return out;
}

/** Every workspace member directory, relative to `root`, deduplicated and sorted. */
export function workspacePackageDirs(root) {
  const dirs = new Set();
  for (const glob of workspaceGlobs(root)) {
    for (const dir of expandGlob(root, glob)) dirs.add(dir);
  }
  return [...dirs].sort();
}

/**
 * Workspace package NAME -> its directory.
 *
 * The map a `--filter=<name>` call needs: the filter names a package, the caller needs a
 * path. A member whose `package.json` is absent, unparseable, or nameless is left OUT —
 * the caller then sees an unresolved name, which is the honest answer, and the callers
 * that care report the unresolved case rather than swallowing it.
 */
export function packageDirsByName(root) {
  const byName = new Map();
  for (const dir of workspacePackageDirs(root)) {
    try {
      const name = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).name;
      if (name) byName.set(name, dir);
    } catch {
      // Deliberately not reported here: this helper's job is resolution, and a broken
      // member surfaces through whichever guard actually reads that package.
    }
  }
  return byName;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
