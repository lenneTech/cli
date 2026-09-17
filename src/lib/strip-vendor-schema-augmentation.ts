import type { GluegunFilesystem } from 'gluegun';

import { globSync } from 'glob';

import { isSymlink } from './fs-utils';

/**
 * Drop `declare module '<nuxt|@nuxt>/schema' { … }` blocks that only augment
 * `PublicRuntimeConfig`, leaving a note in their place.
 *
 * Brace-counted rather than regex-matched to the closing brace: a block may grow
 * more members, and a pattern pinned to today's exact two lines would silently
 * stop matching the moment it does — reintroducing the bug with no test failing,
 * because the symptom only appears in a generated project.
 *
 * A block that augments anything OTHER than `PublicRuntimeConfig` is left alone.
 * Those carry real declarations (module options, hooks) with no cycle, and
 * deleting them would trade a typing bug for a worse one.
 */
export function stripAugmentationBlocks(source: string, onSkip?: (reason: string) => void): string {
  const OPEN = /declare module ['"](?:@nuxt|nuxt)\/schema['"]\s*\{/g;
  let out = source;
  // A forward cursor rather than restarting `exec` from 0 after every rewrite.
  // The restart made the matching branch O(k²) in the block count — measured
  // 40 ms at 400 blocks, 558 ms at 1600. Real input is k=2, so this is shape
  // rather than cost; the cursor is simply the honest way to write it, and it
  // removes the recursion the non-matching branch needed.
  let searchFrom = 0;

  for (;;) {
    OPEN.lastIndex = searchFrom;
    const match = OPEN.exec(out);
    if (!match) break;

    const bodyStart = match.index + match[0].length;
    const end = matchingBrace(out, bodyStart);
    if (end === -1) {
      // Unbalanced (or a brace the scanner could not follow). Leaving it is the
      // safe direction — truncating would break the file — but it must NOT be
      // silent: the augmentation stays, so `config.public.*` is `unknown` in the
      // generated project and nothing said so. Report and stop.
      onSkip?.(
        "could not find the end of a `declare module '…/schema'` block; the augmentation was left in place. " +
          'Remove it by hand, or `config.public.*` will type as `unknown` in this project.',
      );
      break;
    }

    const body = out.slice(bodyStart, end);
    if (!/\bPublicRuntimeConfig\b/.test(body) || /\binterface\s+(?!PublicRuntimeConfig\b)/.test(body)) {
      // Not ours, or carries other declarations too — keep it and move past it.
      searchFrom = end + 1;
      continue;
    }

    const note =
      '// The `nuxt/schema` PublicRuntimeConfig augmentation was removed by `lt` when this\n' +
      '// core was vendored. In node_modules it is harmless; as project source it augments\n' +
      '// the same interface twice (`nuxt/schema` re-exports `@nuxt/schema`) and closes a\n' +
      "// cycle with Nuxt's generated runtime-config types — TS2310, hidden by skipLibCheck,\n" +
      '// which makes every `config.public.*` read `unknown`. The keys are unaffected: Nuxt\n' +
      "// writes them into the generated types from the module's runtime-config defaults.\n" +
      '// Do not restore it here; fix it upstream in @lenne.tech/nuxt-extensions.';
    out = `${out.slice(0, match.index)}${note}${out.slice(end + 1)}`;
    searchFrom = match.index + note.length;
  }

  return out;
}

/**
 * Remove the `nuxt/schema` runtime-config augmentations from a vendored
 * nuxt-extensions core.
 *
 * ## What breaks without this
 *
 * `runtime/types/module.ts` in nuxt-extensions ends with:
 *
 *     declare module 'nuxt/schema'  { interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {} }
 *     declare module '@nuxt/schema' { interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {} }
 *
 * In npm mode that file ships as a `.d.ts` inside `node_modules` and never
 * enters the consumer's TypeScript program. Vendoring copies it to
 * `app/core/runtime/types/module.ts`, which the project's own `include` picks up
 * unconditionally — and `nuxt/schema` re-exports `@nuxt/schema`, so augmenting
 * both names decorates ONE interface twice. Nuxt's generated
 * `.nuxt/types/runtime-config.d.ts` then closes the loop with its own
 * `interface PublicRuntimeConfig extends UserPublicRuntimeConfig` (imported from
 * `nuxt/schema`), and TypeScript reports:
 *
 *     .nuxt/types/runtime-config.d.ts: error TS2310:
 *       Type 'PublicRuntimeConfig' recursively references itself as a base type.
 *
 * An interface in that state resolves every member to `unknown`. So in every
 * vendor-mode project — the DEFAULT for `lt fullstack init` — `config.public.x`
 * is `unknown` rather than its declared type, and `nuxt typecheck` fails on
 * ordinary, correct code.
 *
 * ## Why it took so long to find
 *
 * Nuxt sets `skipLibCheck: true`, which suppresses TS2310 because it is reported
 * in a `.d.ts`. The cause is therefore invisible and only the consequence shows:
 * a plain `Argument of type 'unknown' is not assignable to parameter of type
 * 'string'` at a call site that is not wrong. That is why the trap was previously
 * written up as "vendor mode does not emit the schema block" — in
 * `nuxt-base-starter/nuxt-base-template/CLAUDE.md` and in the JSDoc of that
 * template's `app/utils/app-origin.ts`, both since corrected. The block IS
 * emitted, and is byte-identical between the two modes (`diff` of the two
 * generated `.nuxt/types/runtime-config.d.ts` is empty). Measured 2026-08-22 by
 * converting the template and re-running the type gate with
 * `--skipLibCheck false`.
 *
 * ## Why removing it costs nothing
 *
 * `ltExtensions` does not reach the consumer through this augmentation. The
 * module sets its runtime-config defaults at build time, so Nuxt writes the whole
 * shape into `SharedPublicRuntimeConfig` in the generated file. Verified after
 * stripping: `config.public.ltExtensions.auth.enabled` is `boolean`,
 * `.basePath` is `string`, `config.public.siteUrl` is `string`, and the type gate
 * is clean.
 *
 * The conversion is the right owner: it is the step that turns package typings
 * into project source, so it owns what that change of status implies.
 *
 * @returns the files that were modified, plus any block it could not process —
 *          which the caller MUST surface, because a skipped block means the bug
 *          is still there and only the transform knows it.
 */
export function stripVendorSchemaAugmentation(options: {
  /** The vendored core directory, e.g. `<app>/app/core`. */
  coreDir: string;
  filesystem: GluegunFilesystem;
}): { touched: string[]; warnings: string[] } {
  const { coreDir, filesystem } = options;
  if (!filesystem.isDirectory(coreDir)) return { touched: [], warnings: [] };
  // A linked sub-project points at the user's own checkout; rewriting files there
  // would edit their repository. Same guard the workspace helpers already apply.
  if (isSymlink(coreDir)) return { touched: [], warnings: [] };

  const touched: string[] = [];
  const warnings: string[] = [];
  // `glob`, not `filesystem.find`: gluegun's find is fs-jetpack, which builds its
  // matcher by concatenating the resolved absolute base path in front of the glob
  // (`fs-jetpack/lib/utils/matcher.js` → `convertPatternToAbsolutePath`). On Windows
  // that base is backslash-separated and minimatch reads a backslash inside a
  // PATTERN as an escape, so `D:\…\core/**/*.ts` collapses to `D:coresrc/**/*.ts`
  // and matches nothing — minimatch normalises separators on the file side only.
  // The strip then reported success while the TS2310 augmentation stayed in every
  // Windows-converted project. `glob` keeps pattern and base directory apart and
  // normalises separators itself. Same fix as `api-mode.ts`'s `globFiles`. glob does
  // not follow symlinked directories, unlike jetpack — which is the direction the
  // guard above already wants: nothing inside a linked checkout gets rewritten.
  for (const file of globSync('**/*.ts', { absolute: true, cwd: coreDir, dot: true, nodir: true })) {
    const content = filesystem.read(file);
    if (!content || !content.includes('PublicRuntimeConfig')) continue;

    const patched = stripAugmentationBlocks(content, (reason) => {
      warnings.push(`${file}: ${reason}`);
    });
    if (patched === content) continue;

    filesystem.write(file, patched);
    touched.push(file);
  }
  return { touched, warnings };
}

/**
 * Index of the `}` closing the block whose body starts at `from`, or -1.
 *
 * Skips over string literals, template literals and comments. Counting raw
 * braces looked adequate — the augmentation bodies are two plain
 * `interface … extends … {}` lines — but a fuzz pass found both failure modes,
 * and both are silent:
 *
 * - a `}` inside a string (`{ open: '}' }`) drops depth to 0 early, so the strip
 *   cuts mid-block and leaves a stray `}` behind. The vendored file then does not
 *   compile, in a project the developer just generated.
 * - a `{` inside a string (`type X = '{'`) never balances, this returns -1, the
 *   caller stops, and the augmentation is silently RETAINED — the exact TS2310
 *   bug the whole transform exists to remove, with nothing printed.
 *
 * Neither triggers on today's nuxt-extensions. But this file's own contract is
 * that the block may grow members (that is why it counts braces instead of
 * matching a fixed pattern), and the day a member carries a brace in a string is
 * the day it misfires.
 */
function matchingBrace(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];

    // Line comment — nothing structural until the newline.
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    // Block comment.
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }
    // String or template literal. Templates may nest `${…}`, which would need a
    // full parser to follow — so a template is treated as opaque, which is the
    // safe direction: at worst a brace inside `${}` is ignored and the caller
    // gets -1 and warns, rather than cutting the file in the wrong place.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        // An unterminated single/double-quoted string cannot span a newline.
        else if (text[i] === '\n' && quote !== '`') return -1;
        i++;
      }
      if (i >= text.length) return -1;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
