/**
 * Single source of truth for the "Vendor-Mode Notice" blocks that the CLI
 * writes into project CLAUDE.md files.
 *
 * Why this exists: when a project runs in vendor mode, Claude Code (and humans)
 * must know — from the project itself, without the lt-dev plugin installed —
 * that the framework lives in a vendored `core/` tree and which command syncs
 * it (`update`) vs. ports local fixes back (`contribute`). The plugin hooks are
 * a proactive safety net, but they only fire when the plugin is installed; the
 * CLAUDE.md block is the plugin-independent channel.
 *
 * Three blocks are generated:
 *   - Backend  → `projects/api/CLAUDE.md`   (marker {@link BACKEND_VENDOR_MARKER})
 *   - Frontend → `projects/app/CLAUDE.md`   (marker {@link FRONTEND_VENDOR_MARKER})
 *   - Root     → workspace `CLAUDE.md`      (marker {@link ROOT_VENDOR_MARKER})
 *
 * The root block is new: Claude often reads the monorepo root CLAUDE.md first,
 * so it needs a short pointer to the per-subproject vendor docs.
 *
 * Each block starts with its HTML marker comment and ends with a `---`
 * horizontal rule, so {@link upsertVendorBlock} / {@link removeVendorBlock} can
 * find and replace exactly the generated region without touching hand-written
 * content below it.
 */

export const BACKEND_VENDOR_MARKER = '<!-- lt-vendor-marker -->';
export const FRONTEND_VENDOR_MARKER = '<!-- lt-vendor-marker-frontend -->';
export const ROOT_VENDOR_MARKER = '<!-- lt-vendor-marker-root -->';

/** Minimal filesystem surface — compatible with gluegun's `filesystem`. */
export interface VendorClaudeMdFs {
  exists(path: string): unknown;
  read(path: string): null | string | undefined;
  write(path: string, content: string): unknown;
}

/** Describes the vendor state of a workspace for {@link healVendorClaudeMd}. */
export interface VendorClaudeMdState {
  /** Backend api project dir (contains CLAUDE.md), if present. */
  apiDir?: string;
  /** Frontend app project dir (contains CLAUDE.md), if present. */
  appDir?: string;
  /** True when the backend (`@lenne.tech/nest-server`) runs in vendor mode. */
  backendVendor: boolean;
  /** True when the frontend (`@lenne.tech/nuxt-extensions`) runs in vendor mode. */
  frontendVendor: boolean;
  /** Monorepo root dir (contains the workspace CLAUDE.md), if this is a workspace. */
  workspaceRoot?: string;
}

/**
 * Vendor-mode notice for the backend api project (`projects/api/CLAUDE.md`).
 */
export function buildBackendVendorBlock(): string {
  return block([
    BACKEND_VENDOR_MARKER,
    '',
    '# Vendor-Mode Notice',
    '',
    'This api project runs in **vendor mode**: the `@lenne.tech/nest-server`',
    'core/ tree has been copied directly into `src/core/` as first-class',
    'project code. There is **no** `@lenne.tech/nest-server` npm dependency.',
    '',
    '- **Read framework code from `src/core/**`** — not from `node_modules/`.',
    '- **Generated imports use relative paths** to `src/core`, e.g.',
    "  `import { CrudService } from '../../../core';`",
    '  The exact depth depends on the file location. `lt server module`',
    '  computes it automatically.',
    '- **Baseline + patch log** live in `src/core/VENDOR.md`. Log any',
    '  substantial local change there so the `nest-server-core-updater`',
    '  agent can classify it at sync time.',
    '- **Update flow:** run `/lt-dev:backend:update-nest-server-core` (the',
    '  agent clones upstream, computes a delta, and presents a review). The',
    '  update also raises npm packages to at least the upstream baseline',
    '  (via `/lt-dev:maintenance:maintain`).',
    '- **Contribute back:** run `/lt-dev:backend:contribute-nest-server-core`',
    '  to propose local fixes as upstream PRs.',
    '- **Freshness check:** `pnpm run check:vendor-freshness` warns (non-',
    '  blockingly) when upstream has a newer release than the baseline.',
  ]);
}

/**
 * Vendor-mode notice for the frontend app project (`projects/app/CLAUDE.md`).
 */
export function buildFrontendVendorBlock(): string {
  return block([
    FRONTEND_VENDOR_MARKER,
    '',
    '# Vendor-Mode Notice (Frontend)',
    '',
    'This frontend project runs in **vendor mode**: the `@lenne.tech/nuxt-extensions`',
    'module has been copied directly into `app/core/` as first-class',
    'project code. There is **no** `@lenne.tech/nuxt-extensions` npm dependency.',
    '',
    '- **Read framework code from `app/core/**`** — not from `node_modules/`.',
    "- **nuxt.config.ts** references `'./app/core/module'` instead of",
    "  `'@lenne.tech/nuxt-extensions'`.",
    '- **Baseline + patch log** live in `app/core/VENDOR.md`. Log any',
    '  substantial local change there so the `nuxt-extensions-core-updater`',
    '  agent can classify it at sync time.',
    '- **Update flow:** run `/lt-dev:frontend:update-nuxt-extensions-core`. The',
    '  update also raises npm packages to at least the upstream baseline',
    '  (via `/lt-dev:maintenance:maintain`).',
    '- **Contribute back:** run `/lt-dev:frontend:contribute-nuxt-extensions-core`.',
    '- **Freshness check:** `pnpm run check:vendor-freshness` warns when',
    '  upstream has a newer release than the baseline.',
  ]);
}

/**
 * Vendor-mode notice for the monorepo root (`<workspace>/CLAUDE.md`).
 *
 * Tailored to which halves are vendored so Claude sees only the relevant
 * commands. At least one of `backend` / `frontend` must be true; otherwise the
 * caller should {@link removeVendorBlock} instead of writing an empty notice.
 */
export function buildRootVendorBlock(opts: { backend: boolean; frontend: boolean }): string {
  const { backend, frontend } = opts;
  const lines: string[] = [
    ROOT_VENDOR_MARKER,
    '',
    '# Vendor-Mode Notice (Monorepo)',
    '',
    'This workspace runs at least one framework in **vendor mode** — the',
    'framework source is vendored directly into the project tree instead of',
    'being an npm dependency. Read framework code from the vendored `core/`',
    'trees, not from `node_modules/`.',
    '',
    '**Vendored frameworks:**',
  ];
  if (backend) {
    lines.push(
      '- **Backend** (`@lenne.tech/nest-server`): `projects/api/src/core/` —',
      '  details in `projects/api/CLAUDE.md` and `projects/api/src/core/VENDOR.md`.',
    );
  }
  if (frontend) {
    lines.push(
      '- **Frontend** (`@lenne.tech/nuxt-extensions`): `projects/app/app/core/` —',
      '  details in `projects/app/CLAUDE.md` and `projects/app/app/core/VENDOR.md`.',
    );
  }
  lines.push(
    '',
    '**Update** (sync from upstream; also raises npm packages to at least the',
    'upstream baseline via `/lt-dev:maintenance:maintain`):',
  );
  if (backend) {
    lines.push('- Backend: `/lt-dev:backend:update-nest-server-core`');
  }
  if (frontend) {
    lines.push('- Frontend: `/lt-dev:frontend:update-nuxt-extensions-core`');
  }
  lines.push('', '**Contribute back** generally-useful core fixes as upstream PRs:');
  if (backend) {
    lines.push('- Backend: `/lt-dev:backend:contribute-nest-server-core`');
  }
  if (frontend) {
    lines.push('- Frontend: `/lt-dev:frontend:contribute-nuxt-extensions-core`');
  }
  lines.push(
    '',
    'Project-specific code never goes into a `core/` tree — see each',
    "subproject's VENDOR.md Modification Policy.",
  );
  return block(lines);
}

/** True when `content` already contains the given vendor marker. */
export function hasVendorBlock(content: string, marker: string): boolean {
  return content.includes(marker);
}

/**
 * Bring every CLAUDE.md in a workspace in line with its current vendor state:
 * upsert the matching notice block where a framework is vendored, remove it
 * where it is not. Idempotent — running it on an already-correct workspace
 * changes nothing.
 *
 * This is what makes `lt fullstack update` able to *heal* pre-existing or
 * drifted vendor projects (e.g. ones scaffolded before the root notice existed,
 * or whose notice fell out of date).
 *
 * @returns the list of CLAUDE.md paths that were actually modified.
 */
export function healVendorClaudeMd(fs: VendorClaudeMdFs, state: VendorClaudeMdState): string[] {
  const changed: string[] = [];

  const apply = (path: string, marker: string, desiredBlock: null | string): void => {
    if (!fs.exists(path)) {
      return;
    }
    const content = fs.read(path) || '';
    const next = desiredBlock ? upsertVendorBlock(content, marker, desiredBlock) : removeVendorBlock(content, marker);
    if (next !== content) {
      fs.write(path, next);
      changed.push(path);
    }
  };

  if (state.apiDir) {
    apply(
      joinPath(state.apiDir, 'CLAUDE.md'),
      BACKEND_VENDOR_MARKER,
      state.backendVendor ? buildBackendVendorBlock() : null,
    );
  }

  if (state.appDir) {
    apply(
      joinPath(state.appDir, 'CLAUDE.md'),
      FRONTEND_VENDOR_MARKER,
      state.frontendVendor ? buildFrontendVendorBlock() : null,
    );
  }

  if (state.workspaceRoot) {
    const anyVendor = state.backendVendor || state.frontendVendor;
    apply(
      joinPath(state.workspaceRoot, 'CLAUDE.md'),
      ROOT_VENDOR_MARKER,
      anyVendor ? buildRootVendorBlock({ backend: state.backendVendor, frontend: state.frontendVendor }) : null,
    );
  }

  return changed;
}

/**
 * Insert the block at the very top of the file **only when it is missing**.
 * Used during conversion so a hand-customized existing block is never clobbered.
 */
export function insertVendorBlockIfMissing(content: string, marker: string, newBlock: string): string {
  if (content.includes(marker)) {
    return content;
  }
  return newBlock + content;
}

/**
 * Remove the generated block (marker through the first `---`) and trim leading
 * blank lines. Used when converting a project back to npm mode.
 */
export function removeVendorBlock(content: string, marker: string): string {
  if (!content.includes(marker)) {
    return content;
  }
  return content.replace(blockRegex(marker), '').replace(/^\n+/, '');
}

/**
 * Insert the block if missing, or replace the existing generated region with the
 * current canonical block (idempotent self-heal). Used by `lt fullstack update`
 * to bring pre-existing / drifted projects up to the current notice.
 */
export function upsertVendorBlock(content: string, marker: string, newBlock: string): string {
  if (!content.includes(marker)) {
    return newBlock + content;
  }
  return content.replace(blockRegex(marker), newBlock);
}

/** Join block lines into the canonical `marker … --- ` shape (ends with `---\n\n`). */
function block(lines: string[]): string {
  // Blank line AFTER the `---` too, so the prepended block is separated from
  // the following template heading by an empty line — oxfmt requires a blank
  // line between a thematic break and a heading, otherwise `format:check`
  // fails on a freshly vendored CLAUDE.md. blockRegex's `---\s*\n?` absorbs
  // the extra newline, so removeVendorBlock stays round-trip-safe.
  return [...lines, '', '---', '', ''].join('\n');
}

/** Build the regex that matches an existing block from its marker to the first `---`. */
function blockRegex(marker: string): RegExp {
  return new RegExp(`${escapeRegExp(marker)}[\\s\\S]*?---\\s*\\n?`);
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function joinPath(dir: string, file: string): string {
  return dir.endsWith('/') ? `${dir}${file}` : `${dir}/${file}`;
}
