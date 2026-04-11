#!/usr/bin/env node
// Check whether the vendored @lenne.tech/nest-server core is up-to-date with the
// latest upstream release. Non-blocking: prints a warning when outdated, but always
// exits 0 so that `check` / `check:fix` pipelines continue.
//
// Reads:
//   projects/api/src/core/VENDOR.md  →  baseline version (e.g. "11.24.1")
//
// Fetches:
//   https://registry.npmjs.org/@lenne.tech/nest-server/latest  →  latest published version
//
// Outputs:
//   - Up-to-date   → stdout: "✓ vendored nest-server core is up-to-date (vX.Y.Z)"
//   - Outdated     → stderr: "⚠ vendored nest-server core is X.Y.Z, latest is A.B.C"
//   - Offline/err  → stderr: warn + exit 0 (never fail)

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR_MD = join(__dirname, '..', '..', 'src', 'core', 'VENDOR.md');

// ANSI color codes (no external deps)
const C = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
};

function warnAndExit(msg) {
  process.stderr.write(`${C.yellow}⚠ ${msg}${C.reset}\n`);
  process.exit(0);
}

function ok(msg) {
  process.stdout.write(`${C.green}✓ ${msg}${C.reset}\n`);
  process.exit(0);
}

// 1. Locate VENDOR.md
if (!existsSync(VENDOR_MD)) {
  warnAndExit(
    `vendor-freshness: VENDOR.md not found at ${VENDOR_MD}. ` +
      `Is this project vendored? Skipping check.`,
  );
}

// 2. Parse baseline version from VENDOR.md
let baselineVersion;
try {
  const content = readFileSync(VENDOR_MD, 'utf-8');
  // Match: "**Baseline-Version:** 11.24.1" or "Baseline-Version: 11.24.1"
  const match = content.match(/Baseline-Version[:*\s]+([\d.]+[\w.-]*)/);
  if (!match) {
    warnAndExit(`vendor-freshness: could not parse Baseline-Version from ${VENDOR_MD}`);
  }
  baselineVersion = match[1];
} catch (err) {
  warnAndExit(`vendor-freshness: failed to read ${VENDOR_MD}: ${err.message}`);
}

// 3. Fetch latest from npm registry (offline-tolerant)
function fetchLatest() {
  return new Promise((resolve) => {
    const req = https.get(
      'https://registry.npmjs.org/@lenne.tech/nest-server/latest',
      { timeout: 5000 },
      (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve(json.version || null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

const latestVersion = await fetchLatest();

if (!latestVersion) {
  warnAndExit(
    `vendor-freshness: could not reach npm registry. ` +
      `Current baseline: ${baselineVersion}. Check skipped.`,
  );
}

// 4. semver compare (simple lexical sort works for X.Y.Z)
function parseSemver(v) {
  const parts = v.split('.').map((p) => parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

const [bMaj, bMin, bPatch] = parseSemver(baselineVersion);
const [lMaj, lMin, lPatch] = parseSemver(latestVersion);

const baselineNum = bMaj * 1e6 + bMin * 1e3 + bPatch;
const latestNum = lMaj * 1e6 + lMin * 1e3 + lPatch;

if (baselineNum === latestNum) {
  ok(`vendored nest-server core is up-to-date (v${baselineVersion})`);
} else if (baselineNum < latestNum) {
  const msg =
    `vendored nest-server core is v${baselineVersion}, ` +
    `latest upstream is v${latestVersion}\n` +
    `${C.dim}  Run /lt-dev:backend:update-nest-server-core to sync${C.reset}`;
  warnAndExit(msg);
} else {
  // baseline > latest: weird but not fatal
  warnAndExit(
    `vendored nest-server core is v${baselineVersion} (ahead of npm latest v${latestVersion}). ` +
      `Possibly tracking an unreleased branch.`,
  );
}
