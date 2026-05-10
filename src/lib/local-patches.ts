/**
 * Idempotent patches for legacy projects that still have hardcoded
 * dev ports. Applied by `lt local init --patch`.
 *
 * Each patch is a regex-based replace that matches only the legacy
 * form. Already-patched files are no-ops.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';

/**
 * Outcome of a single patch invocation. `patched: false` together with
 * `replacements: 0` indicates an idempotent no-op (already patched, file
 * missing, or no legacy form found).
 */
export interface PatchResult {
  /** Absolute path to the file. */
  file: string;
  /** True if the file was modified. */
  patched: boolean;
  /** Number of replacements actually made. */
  replacements: number;
}

/** Run the appropriate patch based on filename. */
export function autoPatch(file: string): PatchResult {
  if (file.endsWith('config.env.ts')) return patchApiConfig(file);
  if (file.endsWith('nuxt.config.ts')) return patchNuxtConfig(file);
  if (file.endsWith('playwright.config.ts')) return patchPlaywrightConfig(file);
  return { file, patched: false, replacements: 0 };
}

/**
 * Patch nest-server-starter-style `src/config.env.ts`:
 * - `port: 3000,` → `port: Number(process.env.PORT) || 3000,`
 *
 * Idempotent — files already patched return `patched: false`. Missing
 * files are also a no-op (matches `patchClaudeMd` behavior).
 */
export function patchApiConfig(file: string): PatchResult {
  if (!existsSync(file)) {
    return { file, patched: false, replacements: 0 };
  }
  const before = readFileSync(file, 'utf8');
  let count = 0;
  const after = before.replace(/^(\s*)port:\s*3000\s*,$/gm, (_match, indent: string) => {
    count++;
    return `${indent}port: Number(process.env.PORT) || 3000,`;
  });
  if (count === 0) {
    return { file, patched: false, replacements: 0 };
  }
  writeFileSync(file, after, 'utf8');
  return { file, patched: true, replacements: count };
}

/**
 * Inject a "Local Development (Parallel Projects)" block with the
 * project's concrete ports into CLAUDE.md. Idempotent — re-running
 * with the same ports is a no-op; re-running with different ports
 * updates the block in place.
 *
 * The block is delimited by HTML comments so it can be located and
 * replaced reliably.
 */
export function patchClaudeMd(
  file: string,
  options: { apiPort: number; appPort: number; dbName?: string; slug: string },
): PatchResult {
  const { apiPort, appPort, dbName, slug } = options;
  const startMarker = '<!-- lt-local:port-block:start -->';
  const endMarker = '<!-- lt-local:port-block:end -->';

  const dbLine = dbName ? `- DB:  \`mongodb://127.0.0.1/${dbName}\`\n` : '';
  const block = [
    startMarker,
    '## Local Development (lt local)',
    '',
    `This project is registered with \`lt local\` (slug: \`${slug}\`). Use these commands to run alongside other lt-projects without port collisions:`,
    '',
    '```bash',
    'lt local up        # Start API + App with project-specific ports',
    'lt local down      # Stop the detached processes',
    'lt local status    # Show running PIDs + bound ports',
    'lt ports           # Inspect all reserved + bound dev ports',
    '```',
    '',
    '**Active ports for THIS project:**',
    '',
    `- API: \`http://localhost:${apiPort}\``,
    `- App: \`http://localhost:${appPort}\``,
    dbLine,
    'Env vars (set automatically by `lt local up`): `PORT`, `BASE_URL`, `APP_URL`, `NUXT_API_URL`, `NUXT_PUBLIC_API_URL`, `NUXT_PUBLIC_SITE_URL`, `NUXT_PUBLIC_STORAGE_PREFIX`, `NSC__MONGOOSE__URI`. **Never assume ports 3000/3001 for this project** — they may belong to a parallel project.',
    '',
    endMarker,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');

  let content = '';
  if (existsSync(file)) {
    content = readFileSync(file, 'utf8');
  } else {
    // Don't create CLAUDE.md from scratch — only patch if it exists.
    return { file, patched: false, replacements: 0 };
  }

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  let next: string;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block in place — the block does not include
    // surrounding whitespace, so we slice exactly from start to end-of-marker.
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + endMarker.length);
    next = before + block + after;
  } else {
    // Append at the end with one blank line separator + trailing newline
    const sep = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    next = `${content}${sep}${block}\n`;
  }

  // Idempotent check: if nothing changed, don't write
  if (next === content) {
    return { file, patched: false, replacements: 0 };
  }
  writeFileSync(file, next, 'utf8');
  return { file, patched: true, replacements: 1 };
}

/**
 * Patch nuxt-base-template-style `nuxt.config.ts`:
 * - `port: 3001,` → `port: Number(process.env.PORT) || 3001,`
 * - `target: 'http://localhost:3000'` → `target: process.env.NUXT_API_URL || 'http://localhost:3000'`
 *
 * Missing files are a no-op (matches `patchClaudeMd` behavior).
 */
export function patchNuxtConfig(file: string): PatchResult {
  if (!existsSync(file)) {
    return { file, patched: false, replacements: 0 };
  }
  const before = readFileSync(file, 'utf8');
  let count = 0;
  let after = before.replace(/^(\s*)port:\s*3001\s*,$/gm, (_match, indent: string) => {
    count++;
    return `${indent}port: Number(process.env.PORT) || 3001,`;
  });
  after = after.replace(/target:\s*'http:\/\/localhost:3000'/g, () => {
    count++;
    return `target: process.env.NUXT_API_URL || 'http://localhost:3000'`;
  });
  if (count === 0) {
    return { file, patched: false, replacements: 0 };
  }
  writeFileSync(file, after, 'utf8');
  return { file, patched: true, replacements: count };
}

/**
 * Patch nuxt-base-template-style `playwright.config.ts`:
 * - `baseURL: 'http://localhost:3001'` → uses NUXT_PUBLIC_SITE_URL
 * - `host: 'http://localhost:3001'`    → uses NUXT_PUBLIC_SITE_URL
 * - `url: 'http://localhost:3001'`     → uses NUXT_PUBLIC_SITE_URL
 *
 * Missing files are a no-op (matches `patchClaudeMd` behavior).
 */
export function patchPlaywrightConfig(file: string): PatchResult {
  if (!existsSync(file)) {
    return { file, patched: false, replacements: 0 };
  }
  const before = readFileSync(file, 'utf8');
  let count = 0;
  let after = before.replace(/baseURL:\s*'http:\/\/localhost:3001'/g, () => {
    count++;
    return `baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'`;
  });
  after = after.replace(/host:\s*'http:\/\/localhost:3001'/g, () => {
    count++;
    return `host: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'`;
  });
  after = after.replace(/url:\s*'http:\/\/localhost:3001'/g, () => {
    count++;
    return `url: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'`;
  });
  if (count === 0) {
    return { file, patched: false, replacements: 0 };
  }
  writeFileSync(file, after, 'utf8');
  return { file, patched: true, replacements: count };
}
