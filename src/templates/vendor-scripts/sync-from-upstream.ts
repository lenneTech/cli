/**
 * Diff-generator for the `lt-dev:nest-server-core-updater` agent.
 *
 * Given a target upstream version, this script:
 *   1. Reads VENDOR.md to find the current baseline version and commit
 *   2. Clones the upstream nest-server repo into /tmp at both the baseline
 *      and the target commit
 *   3. Produces three diffs:
 *        - upstream-delta.patch: what changed upstream between baseline and target
 *        - local-changes.patch:  what we changed locally vs the baseline
 *        - conflicts.json:       structured file-level intersection of both diffs
 *   4. Writes all output to scripts/vendor/sync-results/<timestamp>/
 *
 * Usage:
 *   pnpm run vendor:sync -- --target 11.25.0
 *   (or direct: ts-node scripts/vendor/sync-from-upstream.ts --target 11.25.0)
 *
 * The script does NOT modify source files. It only produces the diffs and
 * a report for the updater-agent to act on.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = join(__dirname, '..', '..');
const VENDOR_DIR = join(PROJECT_ROOT, 'src', 'core');
const VENDOR_MD = join(VENDOR_DIR, 'VENDOR.md');
const OUTPUT_BASE = join(PROJECT_ROOT, 'scripts', 'vendor', 'sync-results');

const UPSTREAM_REPO = 'https://github.com/lenneTech/nest-server';
const TMP_BASELINE = '/tmp/nest-server-sync-baseline';
const TMP_TARGET = '/tmp/nest-server-sync-target';

function die(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

function sh(cmd: string, opts: { cwd?: string; allowFailure?: boolean } = {}): string {
  try {
    return execSync(cmd, {
      cwd: opts.cwd ?? PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    if (opts.allowFailure) {
      const e = err as { stdout?: string };
      return e.stdout ?? '';
    }
    throw err;
  }
}

// 1. Parse arguments
const args = process.argv.slice(2);
let targetVersion: string | null = null;
let targetRef: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target' && i + 1 < args.length) {
    targetVersion = args[++i];
  } else if (args[i] === '--ref' && i + 1 < args.length) {
    targetRef = args[++i];
  }
}

// 2. Verify vendored state
if (!existsSync(VENDOR_MD)) {
  die(`VENDOR.md not found at ${VENDOR_MD}. Not a vendored project.`);
}

const vendorContent = readFileSync(VENDOR_MD, 'utf-8');
const baselineVersionMatch = vendorContent.match(/Baseline-Version[:*\s]+([\d.]+[\w.-]*)/);
const baselineCommitMatch = vendorContent.match(/Baseline-Commit[:*\s`]+([a-f0-9]{40})/);

if (!baselineVersionMatch || !baselineCommitMatch) {
  die(
    `Could not parse Baseline-Version and Baseline-Commit from VENDOR.md. ` +
      `Expected "Baseline-Version: X.Y.Z" and "Baseline-Commit: <sha>".`,
  );
}

const baselineVersion = baselineVersionMatch[1];
const baselineCommit = baselineCommitMatch[1];

// Determine target
if (!targetVersion && !targetRef) {
  // Find latest upstream tag
  const output = sh(
    `git ls-remote --tags ${UPSTREAM_REPO} | awk -F'refs/tags/' '/refs\\/tags\\//{print $2}' | grep -vE '\\^{}$|beta|alpha|rc' | sort -V | tail -1`,
    { allowFailure: false },
  ).trim();
  if (!output) die('Could not determine latest upstream tag.');
  targetVersion = output;
}

const targetIdent = targetRef ?? targetVersion!;

// 3. Prepare output directory
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = join(OUTPUT_BASE, timestamp);
mkdirSync(outputDir, { recursive: true });

process.stdout.write(`Vendor sync analysis\n`);
process.stdout.write(`  Baseline: ${baselineVersion} @ ${baselineCommit}\n`);
process.stdout.write(`  Target:   ${targetIdent}\n`);
process.stdout.write(`  Output:   ${outputDir}\n\n`);

// 4. Clone upstream baseline
process.stdout.write(`Cloning upstream baseline...\n`);
sh(`rm -rf ${TMP_BASELINE}`);
sh(`git clone --quiet ${UPSTREAM_REPO} ${TMP_BASELINE}`);
sh(`git checkout --quiet ${baselineCommit}`, { cwd: TMP_BASELINE });

// 5. Clone upstream target
process.stdout.write(`Cloning upstream target...\n`);
sh(`rm -rf ${TMP_TARGET}`);
sh(`git clone --quiet ${UPSTREAM_REPO} ${TMP_TARGET}`);
sh(`git checkout --quiet ${targetIdent}`, { cwd: TMP_TARGET });
const targetCommit = sh(`git rev-parse HEAD`, { cwd: TMP_TARGET }).trim();

// 6. Generate diffs
process.stdout.write(`Computing upstream delta...\n`);
const upstreamDelta = sh(
  `diff -urN ${TMP_BASELINE}/src ${TMP_TARGET}/src || true`,
  { allowFailure: true },
);
writeFileSync(join(outputDir, 'upstream-delta.patch'), upstreamDelta);

process.stdout.write(`Computing local changes...\n`);
// Compare our flat vendor tree against upstream's src/core subtree for the bulk
// of the framework, plus the top-level files that were flattened.
const localChangesCore = sh(
  `diff -urN ${TMP_BASELINE}/src/core ${VENDOR_DIR} --exclude=VENDOR.md --exclude=LICENSE --exclude=test --exclude=templates --exclude=types --exclude=index.ts --exclude=core.module.ts || true`,
  { allowFailure: true },
);
const localChangesIndex = sh(
  `diff -uN ${TMP_BASELINE}/src/index.ts ${VENDOR_DIR}/index.ts || true`,
  { allowFailure: true },
);
const localChangesCoreModule = sh(
  `diff -uN ${TMP_BASELINE}/src/core.module.ts ${VENDOR_DIR}/core.module.ts || true`,
  { allowFailure: true },
);
const localChangesTest = sh(
  `diff -urN ${TMP_BASELINE}/src/test ${VENDOR_DIR}/test || true`,
  { allowFailure: true },
);

writeFileSync(
  join(outputDir, 'local-changes.patch'),
  [
    '### local-changes: src/core (non-flattened files)',
    localChangesCore,
    '',
    '### local-changes: src/index.ts (flattened)',
    localChangesIndex,
    '',
    '### local-changes: src/core.module.ts (flattened)',
    localChangesCoreModule,
    '',
    '### local-changes: src/test (flattened)',
    localChangesTest,
  ].join('\n'),
);

// 7. Extract file lists from both diffs to compute conflicts
function extractChangedFiles(diff: string): Set<string> {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    // diff -u format: lines like "diff -u file1 file2" or "+++ path/to/file"
    const m = line.match(/^(?:diff -[uN]r?N?\s|\+\+\+\s)(.+)$/);
    if (m) {
      const path = m[1].replace(/^\S+\s+/, '').split('\t')[0].trim();
      if (path && path !== '/dev/null') {
        // Normalize to upstream-style src/core/... path
        const normalized = path
          .replace(TMP_BASELINE + '/', '')
          .replace(TMP_TARGET + '/', '')
          .replace(VENDOR_DIR + '/', 'src/core/');
        files.add(normalized);
      }
    }
  }
  return files;
}

const upstreamFiles = extractChangedFiles(upstreamDelta);
const localFiles = extractChangedFiles(
  [localChangesCore, localChangesIndex, localChangesCoreModule, localChangesTest].join('\n'),
);
const conflicts = [...upstreamFiles].filter((f) => localFiles.has(f));

writeFileSync(
  join(outputDir, 'conflicts.json'),
  JSON.stringify(
    {
      baselineVersion,
      baselineCommit,
      targetVersion: targetIdent,
      targetCommit,
      upstreamChangedFiles: [...upstreamFiles].sort(),
      localChangedFiles: [...localFiles].sort(),
      conflictingFiles: conflicts.sort(),
    },
    null,
    2,
  ),
);

// 8. Write human-readable summary
const summary = `# Upstream Sync Analysis

**Baseline:** ${baselineVersion} (${baselineCommit})
**Target:**   ${targetIdent} (${targetCommit})
**Generated:** ${new Date().toISOString()}

## Changed Files

- Upstream delta: ${upstreamFiles.size} files
- Local changes: ${localFiles.size} files
- **Conflicts: ${conflicts.length} files**

## Conflicts (need human decision)
${conflicts.length === 0 ? '_(none)_' : conflicts.map((f) => `- ${f}`).join('\n')}

## Next Steps

The \`lt-dev:nest-server-core-updater\` agent will pick up this directory and:
1. Parse upstream-delta.patch
2. Categorize each hunk as clean-pick / conflict / not-applicable
3. Apply approved changes with flatten-fix reapplication
4. Run validation loop (tsc / lint / tests)
5. Update VENDOR.md

## Files Generated

- \`upstream-delta.patch\` — raw diff baseline → target
- \`local-changes.patch\` — raw diff baseline → our vendor
- \`conflicts.json\` — structured conflict list
- \`summary.md\` — this file
`;

writeFileSync(join(outputDir, 'summary.md'), summary);

process.stdout.write(`\nDone. Review the summary and run the updater agent:\n`);
process.stdout.write(`  cat ${outputDir}/summary.md\n`);
process.stdout.write(`  /lt-dev:backend:update-nest-server-core --target ${targetIdent}\n`);
