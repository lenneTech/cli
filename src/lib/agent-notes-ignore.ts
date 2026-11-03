import { Dirent, lstatSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { isNonInteractive } from './workspace-integration';

/** What to do with the template's "agent notes stay out of git" rule. */
export type AgentNotesIgnoreDecision = 'ask' | 'keep' | 'remove';

/** Directories that never hold a template's own `.gitignore` and can be large. */
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);

/** A `.gitignore` entry that keeps agent notes (or nest-server's plans) out of git. */
const AGENT_NOTES_ENTRY = /^\*\*\/\.claude\/(?:agent-memory|plans)\/?[ \t]*$/;

const PUBLIC_SPELLINGS = new Set(['', '1', 'true', 'yes']);
const PRIVATE_SPELLINGS = new Set(['0', 'false', 'no']);

/**
 * Apply the agent-notes ignore policy to a freshly scaffolded project.
 *
 * The public base repositories ignore `**\/.claude/agent-memory` (lt-memory links
 * their notes in from a private repository), and their `.gitignore` is also the
 * template. A generated project is usually private, so it decides for itself
 * whether to share its notes: the rule is removed unless the project is public
 * (decided 2026-11-03). `--public` keeps it; without the flag an interactive run
 * asks, and a non-interactive one removes it.
 *
 * Asks nothing and changes nothing when no `.gitignore` below `dir` carries the
 * rule. Never touches anything behind a symlink, so a `--*-link` target, which is
 * the developer's own checkout, stays as it is.
 *
 * @returns false when `--public` carries a value it cannot mean (the caller fails the run)
 */
export async function applyAgentNotesIgnorePolicy(
  toolbox: ExtendedGluegunToolbox,
  dir: string,
  options: { noConfirm: boolean },
): Promise<boolean> {
  const {
    parameters,
    print: { error, info },
    prompt,
  } = toolbox;

  if (findAgentNotesIgnores(dir).length === 0) {
    return true;
  }

  const decision = resolveAgentNotesIgnore(parameters.options.public, isNonInteractive(options.noConfirm));
  if (typeof decision === 'object') {
    error(decision.error);
    return false;
  }

  const keep =
    decision === 'keep' ||
    (decision === 'ask' &&
      (await prompt.confirm(
        'Will this project be public (e.g. open source)? A public project keeps the agent notes (.claude/agent-memory) out of git.',
        false,
      )));

  if (keep) {
    info('Public project: agent notes (.claude/agent-memory) stay out of git.');
    return true;
  }

  const changed = removeAgentNotesIgnores(dir);
  info(`Agent notes (.claude/agent-memory) can be committed: removed the ignore rule from ${changed.join(', ')}.`);
  info('  For a public project, run with --public instead.');
  return true;
}

/**
 * The `.gitignore` files below `root` that carry the agent-notes rule.
 *
 * @returns paths relative to `root` with `/` separators, sorted
 */
export function findAgentNotesIgnores(root: string): string[] {
  const found: string[] = [];
  walkGitignores(root, (path, content) => {
    if (stripAgentNotesIgnore(content) !== null) {
      found.push(relative(root, path).split(sep).join('/'));
    }
  });
  return found.sort();
}

/**
 * Remove the agent-notes rule from every `.gitignore` below `root`.
 *
 * @returns the changed paths relative to `root` with `/` separators, sorted
 */
export function removeAgentNotesIgnores(root: string): string[] {
  const changed: string[] = [];
  walkGitignores(root, (path, content) => {
    const stripped = stripAgentNotesIgnore(content);
    if (stripped !== null) {
      writeFileSync(path, stripped);
      changed.push(relative(root, path).split(sep).join('/'));
    }
  });
  return changed.sort();
}

/**
 * Read the `--public` flag.
 *
 * Presence means public, whatever the spelling (`--public`, `--public=true`,
 * `--public=1`); only an explicit negation (`--no-public`, `--public=false`) means
 * private. Keeping the rule is the side that publishes nothing, so a parse quirk
 * lands there. Any other value is most likely a positional the flag swallowed
 * (`--public my-app`), so it is an error rather than a guess.
 */
export function resolveAgentNotesIgnore(
  publicFlag: unknown,
  nonInteractive: boolean,
): AgentNotesIgnoreDecision | { error: string } {
  if (publicFlag === undefined) {
    return nonInteractive ? 'remove' : 'ask';
  }
  if (publicFlag === true) {
    return 'keep';
  }
  if (publicFlag === false) {
    return 'remove';
  }
  const value = String(publicFlag).trim().toLowerCase();
  if (PUBLIC_SPELLINGS.has(value)) {
    return 'keep';
  }
  if (PRIVATE_SPELLINGS.has(value)) {
    return 'remove';
  }
  return { error: `--public takes no value (got "${String(publicFlag)}"). Put other arguments before it.` };
}

/**
 * Remove the agent-notes entries from one `.gitignore`.
 *
 * Works per paragraph (a run of non-blank lines). A paragraph that holds nothing
 * but comments and agent-notes entries goes as a whole, together with one blank
 * line next to it, because its comment explains exactly that rule. A paragraph
 * that also ignores something else keeps its comment and loses only the entries
 * (nuxt-base-starter documents `.claude/settings.local.json` in the same block).
 * Line endings and the presence of a final newline are kept.
 *
 * @returns the new content, or null when there is no agent-notes entry
 */
export function stripAgentNotesIgnore(content: string): null | string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const endsWithNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/);
  if (endsWithNewline) {
    lines.pop();
  }
  if (!lines.some((line) => AGENT_NOTES_ENTRY.test(line))) {
    return null;
  }

  const isBlank = (line: string): boolean => line.trim() === '';
  const isComment = (line: string): boolean => line.trimStart().startsWith('#');
  const drop = new Set<number>();

  for (let start = 0; start < lines.length;) {
    if (isBlank(lines[start])) {
      start++;
      continue;
    }
    let end = start;
    while (end + 1 < lines.length && !isBlank(lines[end + 1])) {
      end++;
    }
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const entries = indices.filter((i) => AGENT_NOTES_ENTRY.test(lines[i]));
    if (entries.length > 0) {
      const othersRemain = indices.some((i) => !isComment(lines[i]) && !AGENT_NOTES_ENTRY.test(lines[i]));
      if (othersRemain) {
        entries.forEach((i) => drop.add(i));
      } else {
        indices.forEach((i) => drop.add(i));
        if (start > 0 && isBlank(lines[start - 1])) {
          drop.add(start - 1);
        } else if (end + 1 < lines.length && isBlank(lines[end + 1])) {
          drop.add(end + 1);
        }
      }
    }
    start = end + 1;
  }

  const kept = lines.filter((_, i) => !drop.has(i));
  return kept.join(eol) + (endsWithNewline && kept.length > 0 ? eol : '');
}

/**
 * Visit every regular `.gitignore` below `root`, without following a symlink: a
 * linked root, directory or `.gitignore` may lead out of the project.
 */
function walkGitignores(root: string, visit: (path: string, content: string) => void): void {
  try {
    if (lstatSync(root).isSymbolicLink()) {
      return;
    }
  } catch {
    return;
  }

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && entry.name === '.gitignore') {
        visit(path, readFileSync(path, 'utf8'));
      } else if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) {
        walk(path);
      }
    }
  };
  walk(root);
}
