/**
 * Frontend-specific blocks in lt-monorepo's root CLAUDE.md.
 *
 * The template describes both frontends; each framework's part sits between
 * marker lines (contract with lt-monorepo and the lt-dev `sync-claude-md`
 * command, plan.md §5.6):
 *
 *   <!-- lt:frontend nuxt -->
 *   …only true for a Nuxt app…
 *   <!-- /lt:frontend -->
 *
 * `lt fullstack init` / `add-app` keep the block of the chosen frontend without
 * its marker lines and drop every other block with its markers, so a workspace's
 * CLAUDE.md never tells an agent about a framework the project does not use.
 * `{{FRONTEND_FRAMEWORK}}` placeholders are left alone; init replaces them.
 */

import { FrontendKind } from './frontend-kind';

const START = /^\s*<!--\s*lt:frontend\s+([a-z]+)\s*-->\s*$/;
const END = /^\s*<!--\s*\/lt:frontend\s*-->\s*$/;

/** The result of {@link selectFrontendBlocks}. */
export interface FrontendBlockSelection {
  /** The rewritten content (unchanged when `problem` is set). */
  content: string;
  /** Why the content was left untouched: an unclosed or nested block. */
  problem?: string;
}

/** True when `content` carries at least one frontend marker. */
export function hasFrontendBlocks(content: string): boolean {
  return content.split(/\r?\n/).some((line) => START.test(line) || END.test(line));
}

/**
 * Keeps the blocks of `kind`, drops the others (see the module comment). A blank
 * line left on both sides of a dropped block collapses into one.
 *
 * An unbalanced file (a start without an end, an end without a start, a block
 * inside a block) is returned UNCHANGED with a `problem`: guessing where a block
 * ends could delete the rest of the file.
 */
export function selectFrontendBlocks(content: string, kind: FrontendKind): FrontendBlockSelection {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let open: undefined | { keep: boolean; line: number };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = START.exec(line);
    if (start) {
      if (open) {
        return { content, problem: `frontend block opened in line ${i + 1} inside the block of line ${open.line}` };
      }
      open = { keep: start[1] === kind, line: i + 1 };
      continue;
    }
    if (END.test(line)) {
      if (!open) {
        return { content, problem: `frontend block closed in line ${i + 1} without being opened` };
      }
      const dropped = !open.keep;
      open = undefined;
      if (dropped && out.length > 0 && out[out.length - 1].trim() === '' && (lines[i + 1] ?? '').trim() === '') {
        out.pop();
      }
      continue;
    }
    if (!open || open.keep) {
      out.push(line);
    }
  }
  if (open) {
    return { content, problem: `frontend block opened in line ${open.line} is never closed` };
  }
  return { content: out.join(eol) };
}
