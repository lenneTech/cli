/**
 * Idempotent patches applied by `lt dev init`.
 *
 * Goal: take a project that still has hardcoded `localhost:3000`
 * defaults and make it env-aware so it can be served behind Caddy
 * under `https://<slug>.localhost`.
 *
 * Each patch is a regex-based replace that matches only the legacy
 * form. Already-patched files are no-ops.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';

import { DevIdentity } from './dev-identity';

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
    next = `${content}${sep}${block}\n`;
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
 *   1. Top-of-file: `if (existsSync('.lt-dev/.env')) loadEnv(...)` block,
 *      bracketed by `// >>> lt-dev:bridge >>>` markers.
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
  const bridgeStart = '// >>> lt-dev:bridge >>>';
  const bridgeEnd = '// <<< lt-dev:bridge <<<';
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
    '  if (__ltDevExists(__candidate)) { __ltDevEnvFile = __candidate; break; }',
    '  const __parent = __ltDevDirname(__ltDevDir);',
    '  if (__parent === __ltDevDir) break;',
    '  __ltDevDir = __parent;',
    '}',
    'if (__ltDevEnvFile) {',
    '  for (const __ln of __ltDevRead(__ltDevEnvFile, "utf8").split(/\\r?\\n/)) {',
    '    const __m = __ln.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);',
    '    if (__m && process.env[__m[1]] === undefined) process.env[__m[1]] = __m[2];',
    '  }',
    '}',
    bridgeEnd,
  ].join('\n');
  const bridgeStartIdx = after.indexOf(bridgeStart);
  const bridgeEndIdx = after.indexOf(bridgeEnd);
  if (bridgeStartIdx === -1) {
    after = `${bridgeBlock}\n${after}`;
    count++;
  } else if (bridgeEndIdx !== -1) {
    const rebuilt = after.slice(0, bridgeStartIdx) + bridgeBlock + after.slice(bridgeEndIdx + bridgeEnd.length);
    if (rebuilt !== after) {
      after = rebuilt;
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
