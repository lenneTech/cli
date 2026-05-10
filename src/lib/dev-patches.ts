/**
 * Idempotent patches applied by `lt dev migrate`.
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

/** API: `port: 3000,` → `port: Number(process.env.PORT) || 3000,`. */
export function patchApiConfig(file: string): PatchResult {
  if (!existsSync(file)) return { file, patched: false, replacements: 0 };
  const before = readFileSync(file, 'utf8');
  let count = 0;
  const after = before.replace(/^(\s*)port:\s*3000\s*,$/gm, (_m, indent: string) => {
    count++;
    return `${indent}port: Number(process.env.PORT) || 3000,`;
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
    '## Local Development (lt dev)',
    '',
    `This project is registered with \`lt dev\` (slug: \`${identity.slug}\`). Use these commands to run alongside other lt projects without cross-wiring or port collisions:`,
    '',
    '```bash',
    'lt dev up        # Start API + App behind Caddy with project-specific URLs',
    'lt dev down      # Stop the detached processes + remove Caddy block',
    'lt dev status    # Show running PIDs + bound URLs',
    'lt dev doctor    # Diagnose Caddy/CA/DNS/port issues',
    '```',
    '',
    '**Active URLs for THIS project:**',
    '',
  ];
  if (appSub) lines.push(`- App: \`https://${appSub.hostname}\``);
  if (apiSub) lines.push(`- API: \`https://${apiSub.hostname}\``);
  if (dbName) lines.push(`- DB:  \`mongodb://127.0.0.1/${dbName}\``);
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

  // 2. Top-of-file dotenv bridge — only inject if not already present.
  const bridgeStart = '// >>> lt-dev:bridge >>>';
  const bridgeEnd = '// <<< lt-dev:bridge <<<';
  if (!after.includes(bridgeStart)) {
    const bridgeBlock = [
      bridgeStart,
      '// Auto-load <root>/.lt-dev/.env when `lt dev up` is active so',
      '// external test runners (CLI, IDE, VS Code Playwright Extension)',
      '// pick up project URLs + Caddy CA without inheriting the parent shell.',
      "import { existsSync as __ltDevExists, readFileSync as __ltDevRead } from 'node:fs';",
      "import { resolve as __ltDevResolve } from 'node:path';",
      "const __ltDevEnvFile = __ltDevResolve(process.cwd(), '.lt-dev/.env');",
      'if (__ltDevExists(__ltDevEnvFile)) {',
      '  for (const __ln of __ltDevRead(__ltDevEnvFile, "utf8").split(/\\r?\\n/)) {',
      '    const __m = __ln.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);',
      '    if (__m && process.env[__m[1]] === undefined) process.env[__m[1]] = __m[2];',
      '  }',
      '}',
      bridgeEnd,
      '',
    ].join('\n');
    after = bridgeBlock + after;
    count++;
  }

  if (count === 0) return { file, patched: false, replacements: 0 };
  writeFileSync(file, after, 'utf8');
  return { file, patched: true, replacements: count };
}
