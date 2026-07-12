import type { GluegunFilesystem } from 'gluegun';

// Docker resolves `.dockerignore` patterns against the build CONTEXT ROOT, and
// it only ever reads the file at that root (or `<dockerfile>.dockerignore` next
// to the Dockerfile). A monorepo builds its images from the workspace root
// (`context: .`, `dockerfile: projects/app/Dockerfile`), so the starters' own
// `projects/app/.dockerignore` and `projects/api/.dockerignore` are never
// consulted — the workspace root needs its own file.
//
// The same rule bites the patterns: a bare `node_modules` matches only
// `./node_modules`, never `projects/app/node_modules`. Every pattern that must
// hit a sub-project therefore needs a globstar prefix. A root `.dockerignore`
// that looks complete but uses bare patterns silently ships a developer's local
// `.output` and `.env` into the image — and `nuxt build` reads `.env`, so the
// bundle itself changes.
const REQUIRED_PATTERNS = [
  '**/node_modules',
  '**/.output',
  '**/.nuxt',
  '**/dist',
  // `**/.env` matches a path component EXACTLY, so it does NOT cover
  // `.env.production` / `.env.staging` / `.env.test` — all of which routinely
  // hold real secrets and would otherwise be copied into the build context.
  // `**/.env.*` closes that gap (it also subsumes the old `.env.local` /
  // `.env.*.local`); the trailing `!**/.env.example` re-includes the safe
  // placeholder template and MUST stay after the broad glob to win.
  '**/.env',
  '**/.env.*',
  '!**/.env.example',
  // `.lt-dev/` holds the ENV bridge (`.env.test`, same DB/URLs) and session
  // logs that contain email-verification tokens — never ship them.
  '**/.lt-dev',
  '**/coverage',
  '**/test-results',
  '**/playwright-report',
  '**/*.log',
  '.pnpm-store',
  '.git',
] as const;

const HEADER = `# Docker resolves these patterns against the build CONTEXT ROOT — this directory
# — and never against a Dockerfile's own directory. The starters ship a
# projects/*/.dockerignore for standalone builds; those are NOT read when
# building from here (see docker-compose.yml: \`context: .\`).
#
# For the same reason a bare \`node_modules\` would only match ./node_modules;
# every pattern that must also hit projects/* needs a globstar prefix. Without
# them a local .output would be copied into the image, and \`nuxt build\` would
# read a local .env and bake it into the bundle.
#
# Managed by \`lt fullstack init\` / \`add-api\` / \`add-app\`: missing entries are
# appended, existing ones are never removed. Add project-specific ignores freely.
`;

const MANAGED_MARKER = '# --- required by lt (depth-independent globs) ---';

/**
 * Guarantee a workspace-root `.dockerignore` that keeps host artefacts and
 * secrets out of every image built from this context.
 *
 * Creates the file when missing. When it exists, appends only the required
 * patterns it does not already contain — an existing bare `node_modules` does
 * not satisfy the globstar variant, so both may end up present, which is
 * correct and harmless. Never removes or reorders what the project wrote.
 *
 * Idempotent: a second run on an unchanged file adds nothing.
 *
 * @param options.filesystem  gluegun filesystem toolbox member
 * @param options.projectDir  workspace root (the docker build context)
 * @returns which patterns were added, and whether the file had to be created
 */
export function ensureRootDockerignore(options: { filesystem: GluegunFilesystem; projectDir: string }): {
  added: string[];
  created: boolean;
} {
  const { filesystem, projectDir } = options;
  const path = `${projectDir}/.dockerignore`;

  if (!filesystem.exists(path)) {
    filesystem.write(path, `${HEADER}\n${REQUIRED_PATTERNS.join('\n')}\n`);
    return { added: [...REQUIRED_PATTERNS], created: true };
  }

  const content = filesystem.read(path) || '';
  const present = activePatterns(content);
  const missing = REQUIRED_PATTERNS.filter((pattern) => !present.has(pattern));
  if (missing.length === 0) return { added: [], created: false };

  const separator = content.endsWith('\n') ? '' : '\n';
  filesystem.write(path, `${content}${separator}\n${MANAGED_MARKER}\n${missing.join('\n')}\n`);
  return { added: missing, created: false };
}

/** Non-empty, non-comment lines, trimmed — the patterns actually in effect. */
function activePatterns(content: string): Set<string> {
  return new Set(
    content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}
