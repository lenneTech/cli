/**
 * Idempotent patches applied by `lt dev init`.
 *
 * Goal: take a project that still has hardcoded `localhost:3000`
 * defaults and make it env-aware so it can be served behind Caddy
 * under `https://<slug>.localhost`.
 *
 * Most patches are regex-based replaces that match only the legacy
 * form; the marker-bracketed `lt-dev:bridge` block in
 * playwright.config.ts is located by its markers instead. Already-patched
 * files are no-ops — including when the consumer's own formatter has since
 * restyled an injected block: that block is compared SEMANTICALLY (see
 * `BRIDGE_VERSION` / `normaliseBridgeBlock`), not byte-for-byte.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';

import { DevIdentity } from './dev-identity';

/**
 * Version of the `lt-dev:bridge` block emitted into a consumer's
 * `playwright.config.ts`. It travels IN the markers
 * (`// >>> lt-dev:bridge v2 >>>`), which is what makes a genuine upgrade
 * detectable independently of formatting.
 *
 * **Bump this on every change to `bridgeBlock`** — including a
 * formatting-only one. The content comparison deliberately ignores quote
 * style and whitespace (the consumer's formatter owns that file), so
 * without a bump a cosmetic fix would never reach already-patched
 * projects. That is exactly what happened to 1.32.1's `"utf8"` → `'utf8'`
 * fix, which is why the version exists.
 */
const BRIDGE_VERSION = 2;

/** Matches any bridge marker, versioned or not — v1 shipped without one. */
const BRIDGE_START_RE = /\/\/ >>> lt-dev:bridge(?: v(\d+))? >>>/;
const BRIDGE_END_RE = /\/\/ <<< lt-dev:bridge(?: v(\d+))? <<</;

/** Imports the bridge block owns; a stray copy outside it must be dropped. */
const BRIDGE_IMPORT_RE = /^\s*import \{[^}]*__ltDev(?:Exists|Read|Dirname|Resolve)[^}]*\} from '[^']*';?\s*$/gm;

export interface PatchResult {
  /** Absolute path. */
  file: string;
  /** True if the file was modified. */
  patched: boolean;
  /** Number of replacements actually made. */
  replacements: number;
}

/** Append entry to .gitignore if not already present. */
export function addToGitignore(root: string, entry: string): boolean {
  const path = `${root}/.gitignore`;
  let content = '';
  if (existsSync(path)) content = readFileSync(path, 'utf8');
  const lines = content.split(/\r?\n/);
  if (lines.some((l) => l.trim() === entry || l.trim() === entry.replace(/\/$/, ''))) return false;
  const ensured = `${(content.endsWith('\n') || content.length === 0 ? content : `${content}\n`) + entry}\n`;
  writeFileSync(path, ensured, 'utf8');
  return true;
}

/** Run the appropriate patch based on filename. */
export function autoPatch(file: string): PatchResult {
  if (file.endsWith('config.env.ts')) return patchApiConfig(file);
  if (file.endsWith('nuxt.config.ts')) return patchNuxtConfig(file);
  if (file.endsWith('playwright.config.ts')) return patchPlaywrightConfig(file);
  return { file, patched: false, replacements: 0 };
}

/**
 * Replace the `lt-dev:bridge` span inside a whole file with its canonical
 * comparison form, leaving every other byte untouched.
 *
 * For callers that must decide "is this file exactly what `autoPatch` would
 * produce, or did a developer edit it?" — most importantly
 * `dev-ticket.ts#isPristineLtDevPatch`, which gates whether `lt ticket stop`
 * may discard a dirty config. Since the patcher deliberately tolerates the
 * consumer formatter restyling the block, such a comparison MUST tolerate it
 * too; otherwise a formatter-touched config reads as real developer work and
 * the worktree removal is refused.
 *
 * Everything outside the markers stays byte-exact on purpose — being lenient
 * there could let genuine work be silently discarded.
 */
export function canonicaliseBridgeSpan(content: string): string {
  const start = BRIDGE_START_RE.exec(content);
  const end = BRIDGE_END_RE.exec(content);
  if (!start || !end || end.index <= start.index) return content;
  const endsAt = end.index + end[0].length;
  return (
    content.slice(0, start.index) + normaliseBridgeBlock(content.slice(start.index, endsAt)) + content.slice(endsAt)
  );
}

/**
 * API: make the server listen port honour `process.env.PORT` (injected by
 * `lt dev up` for its Caddy upstream). Handles two patterns found in
 * nest-server `config.env.ts` files:
 *
 *  - the legacy literal `port: 3000,` (e.g. in `deployedConfig()`)
 *  - the offers-pattern `port: process.env.NSC__PORT ? parseInt(process.env.NSC__PORT, 10) : 3000`
 *    found in `localConfig()` — `lt dev` runs the API in local mode, so this
 *    line MUST be patched too or the API ignores the assigned port.
 *
 * Idempotent — lines that already read `process.env.PORT` are left untouched.
 */
export function patchApiConfig(file: string): PatchResult {
  if (!existsSync(file)) return { file, patched: false, replacements: 0 };
  const before = readFileSync(file, 'utf8');
  let count = 0;
  let after = before.replace(/^(\s*)port:\s*3000\s*,$/gm, (_m, indent: string) => {
    count++;
    return `${indent}port: Number(process.env.PORT) || 3000,`;
  });
  // localConfig() keeps the NSC__PORT operator override; PORT (lt dev) wins.
  after = after.replace(/^(\s*)port:\s*process\.env\.NSC__PORT\s*\?[^\n]*:\s*3000\s*,$/gm, (_m, indent: string) => {
    count++;
    return `${indent}port: Number(process.env.PORT) || (process.env.NSC__PORT ? parseInt(process.env.NSC__PORT, 10) : 3000),`;
  });
  if (count === 0) return { file, patched: false, replacements: 0 };
  writeFileSync(file, after, 'utf8');
  return { file, patched: true, replacements: count };
}

/**
 * Inject a "Local Development (lt dev)" block with the project's
 * concrete URLs into CLAUDE.md. Idempotent — re-running with the same
 * URLs is a no-op; re-running with different URLs replaces the block
 * in place.
 */
export function patchClaudeMd(file: string, options: { dbName?: string; identity: DevIdentity }): PatchResult {
  const { dbName, identity } = options;
  const startMarker = '<!-- lt-dev:url-block:start -->';
  const endMarker = '<!-- lt-dev:url-block:end -->';

  const apiSub = identity.subdomains.api;
  const appSub = identity.subdomains.app;
  const lines: string[] = [
    startMarker,
    '',
    '## Local Development (lt dev)',
    '',
    `This project is registered with \`lt dev\` (slug: \`${identity.slug}\`). Use these commands to run alongside other lt projects without cross-wiring or port collisions:`,
    '',
    '```bash',
    'lt dev up        # Start API + App behind Caddy with project-specific URLs',
    'lt dev down      # Stop the detached processes + remove Caddy block',
    'lt dev status    # Show running PIDs + bound URLs',
    'lt dev test      # Ensure up + run the E2E suite with project URLs injected',
    'lt dev doctor    # Diagnose Caddy/CA/DNS/port issues',
    '```',
    '',
    '**Start and test local apps via `lt dev`** — never `pnpm dev` / `pnpm start` / a bare `playwright test` directly; those bind the framework default ports (3000/3001) and collide with parallel projects.',
    '',
    '**Active URLs for THIS project:**',
    '',
  ];
  if (appSub) lines.push(`- App: \`https://${appSub.hostname}\``);
  if (apiSub) lines.push(`- API: \`https://${apiSub.hostname}\``);
  if (dbName) lines.push(`- DB: \`mongodb://127.0.0.1/${dbName}\``);
  lines.push('');
  lines.push(
    'Env vars set automatically by `lt dev up`: `BASE_URL`, `APP_URL`, `NUXT_API_URL`, `NUXT_PUBLIC_API_URL`, `NUXT_PUBLIC_SITE_URL`, `NUXT_PUBLIC_STORAGE_PREFIX`, `NSC__MONGOOSE__URI`, `DATABASE_URL`. **Never assume `localhost:3000` / `localhost:3001` for this project** — those are the framework defaults, not the active URLs.',
  );
  lines.push('');
  lines.push(endMarker);
  const block = lines.join('\n');

  if (!existsSync(file)) return { file, patched: false, replacements: 0 };
  const content = readFileSync(file, 'utf8');
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  let next: string;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + endMarker.length);
    next = before + block + after;
  } else {
    const sep = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    // No trailing newline: oxfmt strips it from .md files, so emitting one
    // makes a freshly patched CLAUDE.md fail `format:check` (read-only) until
    // the next `check` auto-fix. Keep the block flush with EOF.
    next = `${content}${sep}${block}`;
  }
  if (next === content) return { file, patched: false, replacements: 0 };
  writeFileSync(file, next, 'utf8');
  return { file, patched: true, replacements: 1 };
}

/** App: hardcoded port + vite-proxy target → env-aware. */
export function patchNuxtConfig(file: string): PatchResult {
  if (!existsSync(file)) return { file, patched: false, replacements: 0 };
  const before = readFileSync(file, 'utf8');
  let count = 0;
  let after = before.replace(/^(\s*)port:\s*3001\s*,$/gm, (_m, indent: string) => {
    count++;
    return `${indent}port: Number(process.env.PORT) || 3001,`;
  });
  after = after.replace(/target:\s*'http:\/\/localhost:3000'/g, () => {
    count++;
    return `target: process.env.NUXT_API_URL || 'http://localhost:3000'`;
  });
  if (count === 0) return { file, patched: false, replacements: 0 };
  writeFileSync(file, after, 'utf8');
  return { file, patched: true, replacements: count };
}

/**
 * Playwright: hardcoded baseURL/host/url → env-aware, plus a top-of-file
 * dotenv-load of `.lt-dev/.env` so external test runners (CLI, IDE, VS
 * Code Playwright Extension) automatically pick up `lt dev up`'s URLs
 * and the local Caddy CA — without requiring the parent shell to inherit
 * any env.
 *
 * Patches applied (each idempotent):
 *   1. Top-of-file: a dotenv loader that searches UP from cwd for
 *      `.lt-dev/.env`, bracketed by `// >>> lt-dev:bridge vN >>>` markers.
 *      Re-injected when the marker's version differs from `BRIDGE_VERSION`
 *      (a genuine upgrade) or when the block's CODE differs semantically
 *      (tampering / corruption) — but NOT when the consumer's formatter
 *      merely restyled it, which owns this file and must stay free to.
 *   2. Hardcoded baseURL/host/url for `http://localhost:3001` →
 *      `process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'`.
 *   3. `webServer` wrapped in an `LT_DEV_ACTIVE` guard so Playwright reuses
 *      the App already served by `lt dev` / `lt dev test` instead of spawning
 *      its own (which would bind the wrong port and miss the isolated stack).
 *   4. `ignoreHTTPSErrors: true` so Playwright's Chromium accepts the lt dev
 *      Caddy self-signed cert (required for `lt dev test` over HTTPS).
 *   5. Shard-aware timeouts gated on `LT_DEV_TEST_SHARDS` — a `SHARDED` const
 *      plus relaxed `timeout` / `expect` / `navigationTimeout` / `actionTimeout`
 *      under sharded load only, so serial + CI keep their tight, fast-failing
 *      defaults. Each sub-patch is a graceful no-op on a non-standard config.
 *   6. `slowMo: 10` → `0` (pointless per-action delay, multiplied across shards).
 */
export function patchPlaywrightConfig(file: string): PatchResult {
  if (!existsSync(file)) return { file, patched: false, replacements: 0 };
  const before = readFileSync(file, 'utf8');
  let count = 0;
  let after = before;

  // 1. URL-Patches.
  for (const key of ['baseURL', 'host', 'url']) {
    after = after.replace(new RegExp(`${key}:\\s*'http://localhost:3001'`, 'g'), () => {
      count++;
      return `${key}: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'`;
    });
  }

  // 2. Top-of-file dotenv bridge — inject it, or replace an outdated block.
  //    The loader walks UP from cwd to find `.lt-dev/.env`: that file lives
  //    at the repo root, while playwright.config.ts (and the process cwd of
  //    a direct `playwright test` run) usually sit in `projects/app`. The
  //    original cwd-only resolve missed it, so direct runs fell back to
  //    `localhost:3001` and could collide with a parallel project.
  const bridgeStart = `// >>> lt-dev:bridge v${BRIDGE_VERSION} >>>`;
  const bridgeEnd = `// <<< lt-dev:bridge v${BRIDGE_VERSION} <<<`;
  const bridgeBlock = [
    bridgeStart,
    '// Auto-load <root>/.lt-dev/.env when `lt dev up` is active so',
    '// external test runners (CLI, IDE, VS Code Playwright Extension)',
    '// pick up project URLs + Caddy CA without inheriting the parent shell.',
    '// Searches upward from cwd because `.lt-dev/` sits at the repo root',
    '// while playwright.config.ts (and cwd) usually sit in projects/app.',
    "import { existsSync as __ltDevExists, readFileSync as __ltDevRead } from 'node:fs';",
    "import { dirname as __ltDevDirname, resolve as __ltDevResolve } from 'node:path';",
    "let __ltDevEnvFile = '';",
    'for (let __ltDevDir = process.cwd(), __i = 0; __i < 6; __i++) {',
    "  const __candidate = __ltDevResolve(__ltDevDir, '.lt-dev/.env');",
    '  if (__ltDevExists(__candidate)) {',
    '    __ltDevEnvFile = __candidate;',
    '    break;',
    '  }',
    '  const __parent = __ltDevDirname(__ltDevDir);',
    '  if (__parent === __ltDevDir) break;',
    '  __ltDevDir = __parent;',
    '}',
    'if (__ltDevEnvFile) {',
    "  for (const __ln of __ltDevRead(__ltDevEnvFile, 'utf8').split(/\\r?\\n/)) {",
    '    const __m = __ln.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);',
    '    if (__m && process.env[__m[1]] === undefined) process.env[__m[1]] = __m[2];',
    '  }',
    '}',
    bridgeEnd,
  ].join('\n');
  // Locate ANY bridge marker, versioned or not — v1 shipped unversioned and
  // must still be recognised (and upgraded) rather than double-injected.
  const startMatch = BRIDGE_START_RE.exec(after);
  const endMatch = BRIDGE_END_RE.exec(after);
  const bridgeStartIdx = startMatch ? startMatch.index : -1;
  const bridgeEndIdx = endMatch ? endMatch.index : -1;
  // A start marker without a well-ordered end marker is a corrupted block: the
  // slice arithmetic below would duplicate everything between the two (and the
  // user's code with it). `patchClaudeMd` already guards its span this way.
  const spanIsSane = bridgeStartIdx !== -1 && bridgeEndIdx > bridgeStartIdx;

  if (bridgeStartIdx === -1 || !spanIsSane) {
    // Markers present but unusable (e.g. reversed). Strip the STRAY MARKERS
    // ONLY — never the text between them: with the markers out of order that
    // text is the user's own code, not our block, so slicing the span out
    // would delete their work (and slicing it in would duplicate it).
    if (!spanIsSane) after = after.replace(BRIDGE_START_RE, '').replace(BRIDGE_END_RE, '');
    // A formatter with organize-imports may have hoisted the block's imports
    // out of the markers; leaving them behind would duplicate the `__ltDev*`
    // bindings and break the consumer's config with a duplicate-identifier
    // error. They are ours to own, so it is safe to drop them.
    after = after.replace(BRIDGE_IMPORT_RE, '').replace(/^\n+/, '');
    after = `${bridgeBlock}\n${after}`;
    count++;
  } else {
    const existing = after.slice(bridgeStartIdx, bridgeEndIdx + endMatch![0].length);
    // Two independent reasons to re-inject:
    //  (a) VERSION — the marker carries the block's version, so a genuine
    //      upgrade is detected regardless of how the consumer formatted it.
    //      This is what keeps formatting-only fixes shippable (see
    //      BRIDGE_VERSION); an unversioned v1 marker yields `undefined` here.
    //  (b) CODE — the block's code differs semantically, i.e. it was tampered
    //      with or corrupted. Cosmetic reformatting by the consumer's own
    //      formatter is deliberately NOT a reason: rewriting it back on every
    //      run is what used to leave playwright.config.ts permanently dirty in
    //      the working tree, with formatter and patcher flipping it forever.
    const existingVersion = Number(startMatch![1] ?? 0);
    if (existingVersion !== BRIDGE_VERSION || normaliseBridgeBlock(existing) !== normaliseBridgeBlock(bridgeBlock)) {
      const head = after.slice(0, bridgeStartIdx).replace(BRIDGE_IMPORT_RE, '');
      after = head + bridgeBlock + after.slice(bridgeEndIdx + endMatch![0].length);
      count++;
    }
  }

  // 3. Wrap `webServer` in an `LT_DEV_ACTIVE` guard so Playwright does NOT
  //    start/manage its own server when the App is already served by
  //    `lt dev` / `lt dev test` (both export LT_DEV_ACTIVE + the App URL).
  //    The original array/object's closing `]`/`}` becomes the ternary's
  //    false branch, so no bracket-matching is needed. Idempotent.
  if (!/webServer:\s*process\.env\.LT_DEV_ACTIVE/.test(after)) {
    after = after.replace(/webServer:\s*([[{])/, (_match, open: string) => {
      count++;
      return `webServer: process.env.LT_DEV_ACTIVE ? undefined : ${open}`;
    });
  }

  // 4. ignoreHTTPSErrors — accept the `lt dev` Caddy self-signed cert on
  //    `https://*.localhost` (Playwright's bundled Chromium uses its own trust
  //    store, so NODE_EXTRA_CA_CERTS alone is not enough). No-op in CI (http).
  //    Without this, `lt dev test` fails with ERR_CERT_AUTHORITY_INVALID.
  if (!/ignoreHTTPSErrors/.test(after)) {
    after = after.replace(/(\n(\s*)use:\s*\{)/, (_m, whole: string, indent: string) => {
      count++;
      return `${whole}\n${indent}  ignoreHTTPSErrors: true,`;
    });
  }

  // 5. Shard-aware timeouts — `lt dev test --shard N` runs N built stacks +
  //    N Chromium concurrently; the CPU saturates and SSR slows 2-3x. Relax
  //    timeouts ONLY under that load (the CLI exports LT_DEV_TEST_SHARDS), so
  //    serial + CI keep their tight values and fast-failure feedback. Each
  //    sub-patch is idempotent + a graceful no-op on non-standard configs.
  if (!/const SHARDED\b/.test(after) && /export default defineConfig/.test(after)) {
    const shardConst =
      '// `lt dev test --shard N` saturates the CPU (N built SSR servers + N Chromium),\n' +
      '// slowing every navigation. Relax timeouts ONLY under that load — the CLI sets\n' +
      '// LT_DEV_TEST_SHARDS — so serial + CI keep their tight, fast-failing defaults.\n' +
      "const SHARDED = Number(process.env.LT_DEV_TEST_SHARDS || '0') > 1;\n\n";
    after = after.replace(/(export default defineConfig)/, `${shardConst}$1`);
    count++;
  }
  // 5a. per-test timeout (`isWindows ? A : B` form) → add the sharded branch.
  if (/timeout:\s*isWindows\s*\?/.test(after) && !/timeout:\s*isWindows\s*\?[^,\n]*SHARDED/.test(after)) {
    after = after.replace(
      /timeout:\s*isWindows\s*\?\s*([0-9_]+)\s*:\s*([0-9_]+|undefined)/,
      (_m, a: string, b: string) => {
        count++;
        return `timeout: isWindows ? ${a} : SHARDED ? 180_000 : ${b}`;
      },
    );
  }
  // 5b. expect.timeout (only when an `expect: { timeout: N }` already exists).
  if (/expect:\s*\{\s*timeout:\s*[0-9_]+\s*\}/.test(after) && !/expect:\s*\{\s*timeout:\s*SHARDED/.test(after)) {
    after = after.replace(/expect:\s*\{\s*timeout:\s*([0-9_]+)\s*\}/, (_m, t: string) => {
      count++;
      return `expect: { timeout: SHARDED ? 30_000 : ${t} }`;
    });
  }
  // 5c. navigation/action ceilings under shard (inject into `use` if absent).
  if (!/navigationTimeout/.test(after)) {
    after = after.replace(/(\n(\s*)use:\s*\{)/, (_m, whole: string, indent: string) => {
      count++;
      return `${whole}\n${indent}  actionTimeout: SHARDED ? 30_000 : undefined,\n${indent}  navigationTimeout: SHARDED ? 60_000 : undefined,`;
    });
  }
  // 6. slowMo: 10 → 0 — an artificial per-action delay, pointless and multiplied
  //    across N concurrent sharded browsers.
  after = after.replace(/slowMo:\s*10\b/, () => {
    count++;
    return 'slowMo: 0';
  });

  if (count === 0) return { file, patched: false, replacements: 0 };
  writeFileSync(file, after, 'utf8');
  return { file, patched: true, replacements: count };
}

/**
 * Canonical form of a bridge block for comparison purposes.
 *
 * Compares only the CODE: comment lines are dropped entirely, so rewording
 * a comment never triggers a rewrite — and, crucially, code that a reflow
 * folded behind a `//` VANISHES from the comparison and is therefore
 * detected as changed. A plain `\s+ → ' '` collapse would erase newlines
 * instead, which makes a fully commented-out (inert) loader normalise
 * identically to a live one: the block would silently never load
 * `.lt-dev/.env` again and Playwright would fall back to `localhost:3001`.
 *
 * Quote style and intra-line whitespace are normalised away because the
 * consumer's formatter owns this file (which direction it flips is
 * project-specific — do not assume). Blind spot to keep in mind: a change
 * that differs ONLY in quotes or whitespace is invisible here, which is
 * what `BRIDGE_VERSION` is for.
 */
function normaliseBridgeBlock(s: string): string {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('//'))
    .join(' ')
    .replace(/['"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
