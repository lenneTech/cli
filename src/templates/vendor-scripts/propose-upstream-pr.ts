/**
 * Diff-generator for the `lt-dev:nest-server-core-contributor` agent.
 *
 * Analyzes local git commits that touched projects/api/src/core/ since the
 * vendoring baseline, emits per-commit patch files and a human-readable
 * candidate list. Filters out cosmetic commits (format, style, lint:fix).
 * Does NOT cherry-pick or open any PR — that's the contributor agent's job.
 *
 * Usage:
 *   pnpm run vendor:propose-upstream
 *   (or: ts-node scripts/vendor/propose-upstream-pr.ts [--since <sha>])
 *
 * Output directory: scripts/vendor/upstream-candidates/<timestamp>/
 *   - local-commits.json: structured metadata for every commit
 *   - local-diffs/<commit-sha>.patch: per-commit patch file
 *   - summary.md: human-readable candidate list
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = join(__dirname, '..', '..');
const VENDOR_DIR = join(PROJECT_ROOT, 'src', 'core');
const VENDOR_MD = join(VENDOR_DIR, 'VENDOR.md');
const OUTPUT_BASE = join(PROJECT_ROOT, 'scripts', 'vendor', 'upstream-candidates');

const MONOREPO_ROOT = join(PROJECT_ROOT, '..', '..');

function die(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

function sh(cmd: string, opts: { cwd?: string; allowFailure?: boolean } = {}): string {
  try {
    return execSync(cmd, {
      cwd: opts.cwd ?? MONOREPO_ROOT,
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

// Cosmetic message patterns (case-insensitive)
const COSMETIC_PATTERNS = [
  /^chore.*format/i,
  /^style:/i,
  /^chore.*oxfmt/i,
  /^chore.*prettier/i,
  /^chore.*lint:fix/i,
  /^chore.*linting/i,
  /^chore.*apply project formatting/i,
  /^chore.*re-?format/i,
];

interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  files: string[];
  isCosmetic: boolean;
  cosmeticReason: string | null;
}

// 1. Parse arguments
const args = process.argv.slice(2);
let sinceRef: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since' && i + 1 < args.length) {
    sinceRef = args[++i];
  }
}

// 2. Verify vendored state
if (!existsSync(VENDOR_MD)) {
  die(`VENDOR.md not found at ${VENDOR_MD}. Not a vendored project.`);
}

const vendorContent = readFileSync(VENDOR_MD, 'utf-8');
const baselineVersionMatch = vendorContent.match(/Baseline-Version[:*\s]+([\d.]+[\w.-]*)/);
const baselineVersion = baselineVersionMatch?.[1] ?? 'unknown';

// 3. Determine starting point for git log
if (!sinceRef) {
  // Find the commit that added VENDOR.md — that's the vendoring commit
  sinceRef = sh(
    `git log --diff-filter=A --format="%H" -- projects/api/src/core/VENDOR.md | tail -1`,
  ).trim();
  if (!sinceRef) {
    die(
      'Could not find the commit that added VENDOR.md. Pass --since <sha> manually.',
    );
  }
}

// 4. Collect all commits since that ref that touched src/core/
const gitLog = sh(
  `git log --format="%H%x09%s%x09%an%x09%aI" ${sinceRef}..HEAD -- projects/api/src/core/`,
).trim();

if (!gitLog) {
  process.stdout.write(
    `No local commits found since ${sinceRef.substring(0, 8)} touching src/core/. Nothing to propose.\n`,
  );
  process.exit(0);
}

const commits: CommitInfo[] = gitLog
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => {
    const [sha, subject, author, date] = line.split('\t');
    const filesOutput = sh(
      `git show --pretty="" --name-only ${sha} -- projects/api/src/core/`,
    ).trim();
    const files = filesOutput ? filesOutput.split('\n') : [];

    // Cosmetic check by message pattern
    let isCosmetic = false;
    let cosmeticReason: string | null = null;
    for (const pat of COSMETIC_PATTERNS) {
      if (pat.test(subject)) {
        isCosmetic = true;
        cosmeticReason = `commit-message matches ${pat.source}`;
        break;
      }
    }

    // Additional cosmetic check: if diff has only whitespace/formatting changes
    if (!isCosmetic) {
      const diff = sh(`git show --format="" ${sha} -- projects/api/src/core/`);
      // Normalize: drop all whitespace, quote style, trailing commas
      const normalized = diff
        .split('\n')
        .filter((l) => l.startsWith('+') || l.startsWith('-'))
        .filter((l) => !l.startsWith('+++') && !l.startsWith('---'))
        .map((l) => l.slice(1).replace(/\s+/g, '').replace(/['"`]/g, '').replace(/,$/, ''))
        .filter((l) => l.length > 0);

      // Count +/- with the same normalized content — if they cancel out, it's cosmetic
      const plus = normalized.filter((_, i) => diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))[i]);
      // Simpler heuristic: if normalized plus == normalized minus, it's cosmetic
      const plusLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1).replace(/\s+/g, ''));
      const minusLines = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1).replace(/\s+/g, ''));
      const plusSet = new Set(plusLines);
      const minusSet = new Set(minusLines);
      const plusOnlyCount = [...plusSet].filter((l) => !minusSet.has(l) && l.length > 0).length;
      const minusOnlyCount = [...minusSet].filter((l) => !plusSet.has(l) && l.length > 0).length;
      if (plusOnlyCount === 0 && minusOnlyCount === 0 && plusLines.length > 0) {
        isCosmetic = true;
        cosmeticReason = 'normalized diff is empty (whitespace/quotes only)';
      }
    }

    return {
      sha,
      shortSha: sha.substring(0, 8),
      subject,
      author,
      date,
      files,
      isCosmetic,
      cosmeticReason,
    };
  });

// 5. Write output
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = join(OUTPUT_BASE, timestamp);
const diffsDir = join(outputDir, 'local-diffs');
mkdirSync(diffsDir, { recursive: true });

// Save JSON
writeFileSync(
  join(outputDir, 'local-commits.json'),
  JSON.stringify(
    {
      baselineVersion,
      sinceRef,
      generated: new Date().toISOString(),
      total: commits.length,
      cosmetic: commits.filter((c) => c.isCosmetic).length,
      substantial: commits.filter((c) => !c.isCosmetic).length,
      commits,
    },
    null,
    2,
  ),
);

// Save per-commit patch files (only substantial ones)
for (const commit of commits.filter((c) => !c.isCosmetic)) {
  const patch = sh(`git show ${commit.sha} -- projects/api/src/core/`);
  writeFileSync(join(diffsDir, `${commit.shortSha}.patch`), patch);
}

// Save summary
const substantialCommits = commits.filter((c) => !c.isCosmetic);
const cosmeticCommits = commits.filter((c) => c.isCosmetic);

const summary = `# Upstream-PR Candidates

**Baseline version:** ${baselineVersion}
**Since commit:** ${sinceRef.substring(0, 8)}
**Generated:** ${new Date().toISOString()}

## Statistics

- Total commits touching \`src/core/\`: ${commits.length}
- Filtered as cosmetic: ${cosmeticCommits.length}
- **Substantial (candidate pool):** ${substantialCommits.length}

## Substantial Commits (need manual categorization by the contributor agent)

${
  substantialCommits.length === 0
    ? '_No substantial local changes. Nothing to contribute._'
    : substantialCommits
        .map(
          (c) =>
            `### \`${c.shortSha}\` — ${c.subject}\n\n` +
            `- **Author:** ${c.author}\n` +
            `- **Date:** ${c.date}\n` +
            `- **Files:** ${c.files.length}\n` +
            c.files.map((f) => `  - ${f}`).join('\n') +
            `\n- **Patch:** \`local-diffs/${c.shortSha}.patch\`\n`,
        )
        .join('\n')
}

## Filtered Cosmetic Commits

${
  cosmeticCommits.length === 0
    ? '_(none)_'
    : cosmeticCommits
        .map((c) => `- \`${c.shortSha}\` — ${c.subject} _(${c.cosmeticReason})_`)
        .join('\n')
}

## Next Steps

Run the contributor agent:
\`\`\`
/lt-dev:backend:contribute-nest-server-core
\`\`\`

It will:
1. Categorize each substantial commit (upstream-candidate / project-specific / unclear)
2. Check upstream HEAD for duplicates
3. Prepare candidate branches in a local upstream clone with reverse flatten-fix
4. Generate PR-body drafts for human review
5. Present a final list with \`gh pr create\` commands ready to run
`;

writeFileSync(join(outputDir, 'summary.md'), summary);

process.stdout.write(`\nDone. Review:\n`);
process.stdout.write(`  cat ${outputDir}/summary.md\n`);
