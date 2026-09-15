#!/usr/bin/env node
// @lt-check-wrapper 3.13.0
/**
 * Quiet, report-driven wrapper around the project `check` pipeline.
 *
 * Replaces the noisy `pnpm audit && pnpm -r --parallel run check` with:
 *   - a minimal live view — one status line per running project (spinner +
 *     current step), so you always see where the run is;
 *   - abort on the first failing step, printing the captured reason;
 *   - on success a report: the executed steps + their key metrics
 *     (vulnerabilities per level, test counts per area Unit/API/Playwright, …);
 *   - format + lint auto-fix every fixable finding (oxfmt writes, oxlint --fix);
 *     only non-fixable lint errors then remain and fail the run.
 *
 * Flags:
 *   --verbose / -v      stream the full tool output live (deep debugging)
 *   --sequential/--seq  run projects one after another (default: parallel)
 *   --no-fix            read-only gate — do not auto-fix format/lint
 *   --project=<substr>  restrict to matching workspace projects (repeatable)
 *
 * Design: the per-project `check` scripts stay the single source of truth for
 * WHAT runs. This wrapper discovers each workspace project's `check` chain,
 * splits it on `&&`, and runs the steps with status + metrics — so adding or
 * removing a step in a project's `check` needs no change here.
 *
 * Exit code: 0 when every step passed, 1 otherwise (preserves the contract the
 * lt-dev `running-check-script` skill relies on: non-zero === failed).
 *
 * Version marker: the `@lt-check-wrapper` line above names the lt-monorepo
 * release this wrapper ships with. The lt CLI reads it so `lt fullstack update`
 * never replaces a project's wrapper with an older one. `pnpm run release`
 * bumps it (bumpFiles in .versionrc.json), and
 * scripts/check-wrapper-version.test.mjs fails when it drifts from
 * package.json. In a generated project it keeps the release it came from.
 */
import { execSync, spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { C, stripAnsi } from './lib/ansi.mjs';
import {
  advisoryBulkUrl,
  configuredRegistry,
  countSuppressions,
  countUnlistedBySeverity,
  isAuditEndpointUnavailable,
  isAuditResultAmbiguous,
  renderVulnLine,
  sumSeverities,
} from './lib/audit-report.mjs';
import { createBuildTestGate } from './build-test-gate.mjs';
import { expandGlob as expandWorkspaceGlob, workspaceGlobs as readWorkspaceGlobs } from './lib/workspace-packages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const SEQUENTIAL = process.argv.includes('--sequential') || process.argv.includes('--seq');
const NO_FIX = process.argv.includes('--no-fix');
const PROJECT_FILTERS = process.argv.filter((a) => a.startsWith('--project=')).map((a) => a.slice('--project='.length));
// Verbose streams raw output, so the in-place live view is disabled there.
const TTY = Boolean(process.stdout.isTTY) && !VERBOSE;

const shortRel = (rel) => rel.replace(/^projects\//, '');

function fmtDuration(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

// ── Nuxt build-dir isolation for the check's OWN package-manager calls ───────
// The app's `build:check` / `typecheck:*` scripts pin `NUXT_BUILD_DIR` so a
// check never writes the `.nuxt/` a parked `nuxt dev` reads. One writer has no
// script to pin it in: `postinstall: nuxt prepare`. It inherits the env of
// whatever triggered the install — and this script triggers one on every run
// (the hoisted install below). Unpinned, that install rewrites
// `.nuxt/tsconfig.json` under a running dev server, which then type-checks
// without the `~`/`#` aliases and dies on code that is fine.
//
// Applied on TWO levels: as a textual prefix, so `buildGroups` stays a pure
// function a guard can assert against, AND as a real environment variable at
// spawn time. The prefix alone is not enough — a `VAR=value cmd` assignment
// binds only to the first simple command, so a step written with `;` or a
// leading `cd` would be reported as pinned and run unpinned. Both carry the
// same value, so they cannot disagree.
const CHECK_BUILD_DIR = '.nuxt-check';

// Deliberately narrow: a blanket prefix would override the dirs the package.json
// scripts pin themselves. These are the commands that run lifecycle hooks (or,
// for `audit`, may resolve after fixing) and so have no pin of their own.
//
// SINGLE SOURCE: `classify()` derives its install/audit branches from these very
// patterns, so "the pin predicate is at least as wide as the hoist predicate" is
// true BY CONSTRUCTION rather than by assertion. It used to be two hand-written
// regexes that were supposed to agree, and they did not: `classify()` matched a
// bare `\baudit\b`, which also catches `npx audit-ci`, `bash scripts/audit.sh`
// and `pnpm --filter api audit`. Those were hoisted (so no longer ordinary
// steps) but not pinned — and worse, `runAudit` appends ` --json` to whatever
// was labelled "audit", so the check failed on a flag it invented itself.
const PM = String.raw`(?:pnpm|npm|yarn|bun)`;
/** `<pm> install|ci|i` — including the `i` shorthand. */
export const PM_INSTALL = new RegExp(String.raw`\b${PM}\s+(?:install|ci|i)\b`);
/**
 * A REAL package-manager audit (`pnpm audit`, `npm audit`, `yarn npm audit`).
 *
 * Only these are hoisted, because only these produce the JSON that `runAudit`
 * parses — and it appends ` --json` to whatever it is handed. A project script
 * that merely has "audit" in its name (`pnpm run audit:ci`) is a normal step:
 * hoisting it fed it a flag it does not accept, so the check failed on an
 * argument the wrapper invented.
 */
export const PM_AUDIT = new RegExp(String.raw`\b${PM}\s+audit\b`);
/** A project script whose name mentions audit or install — an ordinary step that still needs the pin. */
const PM_RUN_SCRIPT = new RegExp(String.raw`\b${PM}\s+run\s+\S*(?:audit|install)\S*`);
/** Any package-manager call that runs lifecycle hooks and carries no pin of its own. */
export const PM_INVOCATION = new RegExp(`${PM_INSTALL.source}|${PM_AUDIT.source}|${PM_RUN_SCRIPT.source}`);

/**
 * Prefix a package-manager command with the check's isolated Nuxt build dir.
 *
 * Idempotent, and never overrides a pin the command already carries — the
 * existing-pin test is NOT anchored to the start of the string, because the
 * shape the nuxt starter actually ships is `cross-env NUXT_BUILD_DIR=… pnpm …`,
 * which a `^` anchor does not see.
 */
export function pinCheckBuildDir(cmd) {
  if (!PM_INVOCATION.test(cmd) || /(^|\s)NUXT_BUILD_DIR=/.test(cmd)) return cmd;
  return `NUXT_BUILD_DIR=${CHECK_BUILD_DIR} ${cmd}`;
}

/**
 * The environment a step needs beyond the inherited one.
 *
 * Mirrors the textual pin so a shell construct the prefix cannot reach (a `;`
 * separator, a leading `cd`) still gets the isolated build dir. Only for
 * commands the pin applies to — a step that pins itself keeps its own value,
 * because the prefix check already declined to touch it.
 */
function stepEnv(step) {
  return /(^|\s)NUXT_BUILD_DIR=/.test(step.cmd) ? { NUXT_BUILD_DIR: CHECK_BUILD_DIR } : null;
}

// ── step classification ────────────────────────────────────────────────────
// Map a raw command from a `check` chain onto a stable kind + label so the
// report stays readable regardless of the underlying tool (oxfmt/oxlint/tsc/…).
function classify(cmd) {
  const c = cmd.toLowerCase();
  // Dependency install — hoisted to ONE workspace-level run (see buildGroups):
  // api and app chains both start with `pnpm install --frozen-lockfile`, and
  // running those CONCURRENTLY (parallel groups) mutates the same workspace
  // node_modules from two processes at once.
  //
  // Checked BEFORE `vendor-freshness`: that branch is a plain substring test, so
  // a command that mentions it anywhere (`pnpm install --filter vendor-freshness`)
  // used to short-circuit past this one and land in the ordinary step list, where
  // nothing pins NUXT_BUILD_DIR for it.
  //
  // Both predicates come from the pin patterns above, so a command can never be
  // hoisted-but-unpinned. See the SINGLE SOURCE note there.
  if (PM_INSTALL.test(c)) return { fatal: true, kind: 'install', label: 'install' };
  if (PM_AUDIT.test(c)) return { fatal: true, kind: 'audit', label: 'audit' };
  if (c.includes('vendor-freshness')) return { fatal: false, kind: 'vendor', label: 'vendor-freshness' };
  if (c.includes('format:check') || c.includes('oxfmt')) return { fatal: true, kind: 'format', label: 'format' };
  if (c.includes('lint')) return { fatal: true, kind: 'lint', label: 'lint' };
  // A unit-only run is named explicitly, is short, and is not contention
  // sensitive — it carries `light` so the build⊥test gate lets it through (see
  // GATE_CLASS). A bare `pnpm test` is NOT assumed to be light: in the starters
  // it resolves to the API e2e suite, which is exactly what the gate protects.
  if (/(^|&|\s)(pnpm\s+)?test:unit(:|\s|$)/.test(c)) return { fatal: true, kind: 'test', label: 'test', light: true };
  if (/(^|&|\s)(pnpm\s+)?test(:|\s|$)|vitest|jest|test:ci/.test(c)) return { fatal: true, kind: 'test', label: 'test' };
  // `typecheck` runs vue-tsc / tsc, which saturates the machine just like a
  // build — and it does NOT contain the substrings "build" or "tsc", so it used
  // to fall through to `other` and run ungated, fully concurrent with the API
  // e2e suite. The gate then paid its serialisation cost while the second
  // heaviest CPU load in the chain still ran alongside the suite it protects.
  if (/\btypecheck\b/.test(c)) return { fatal: true, kind: 'build', label: 'typecheck' };
  if (c.includes('build') || c.includes('nuxt build') || c.includes('tsc'))
    return { fatal: true, kind: 'build', label: 'build' };
  if (c.includes('check-server-start') || c.includes('server-start'))
    return { fatal: true, kind: 'server', label: 'server-start' };
  return { fatal: true, kind: 'other', label: cmd.length > 32 ? `${cmd.slice(0, 29)}…` : cmd };
}

/**
 * Which mutual-exclusion class a step belongs to, or null when it is ungated.
 *
 * The gate keeps CPU-heavy work off the contention-sensitive API e2e suite. It
 * is deliberately CONSERVATIVE: a bare `test` step is treated as sensitive even
 * though a project's may be light, because the two failure directions are not
 * symmetric — too wide costs wall-clock, too narrow costs the flaky-suite bug
 * this gate exists to fix (DEV-2524).
 */
export function gateClass(step) {
  if (step.kind === 'build') return 'build';
  if (step.kind === 'test') return step.light ? null : 'test';
  return null;
}

// Rewrite a check-only format/lint command into its auto-fixing variant, so a
// `check` run repairs every fixable finding instead of only reporting it.
function toFixCommand(kind, cmd) {
  if (NO_FIX) return cmd;
  if (kind === 'format') {
    if (/\bformat:check\b/.test(cmd)) return cmd.replace(/\bformat:check\b/, 'format');
    if (/\boxfmt\b/.test(cmd)) return cmd.replace(/\s--check\b/, '');
    return cmd;
  }
  if (kind === 'lint') {
    if (/\blint:fix\b/.test(cmd) || /--fix\b/.test(cmd)) return cmd;
    if (/\brun\s+lint\b/.test(cmd)) return cmd.replace(/\brun\s+lint\b/, 'run lint:fix');
    if (/\boxlint\b/.test(cmd)) return cmd.replace(/\boxlint\b/, 'oxlint --fix');
    return cmd;
  }
  return cmd;
}

// ── metric parsers ─────────────────────────────────────────────────────────
// Sum capture group 1 across every match of `re` (which must carry the `g` flag).
// Returns null when nothing matched, so callers can tell "absent" from "zero".
function sumMatches(clean, re) {
  let total = null;
  for (const m of clean.matchAll(re)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) total = (total ?? 0) + n;
  }
  return total;
}
// A single test step may invoke vitest more than once (`test` is
// `vitest:unit && vitest`), emitting one summary block per run. Sum them all —
// reading only the first silently under-reports every later run: the api step
// showed "16 passed" (unit only) while its 69 e2e tests ran unseen.
function parseVitest(out) {
  const clean = stripAnsi(out);
  let passed = sumMatches(clean, /Tests\s+(?:\d+\s+failed[^\n]*?)?(\d+)\s+passed/gi);
  const files = sumMatches(clean, /Test Files\s+(?:\d+\s+failed[^\n]*?)?(\d+)\s+passed/gi);
  let failed = sumMatches(clean, /Tests\s+(\d+)\s+failed/gi);
  // `node --test` (a chain may run one, e.g. over scripts/) reports in node:test format
  // ("ℹ pass N" / "ℹ fail N", or "# pass N" under the TAP reporter), not Vitest's
  // "Tests N passed". Without this fallback parseVitest returned null for it, so
  // the gate tests went uncounted and a green run could show "Total 0 passed".
  if (passed == null) {
    passed = sumMatches(clean, /(?:^|\n)[^\S\n]*[#ℹ][^\S\n]+pass[^\S\n]+(\d+)\b/gi);
  }
  // Checked independently of `passed`: a node:test run that reports only
  // failures has no `pass` line at all, and nesting this inside the branch above
  // made those runs parse as "no tests" instead of as failures.
  if (failed == null) {
    failed = sumMatches(clean, /(?:^|\n)[^\S\n]*[#ℹ][^\S\n]+fail[^\S\n]+(\d+)\b/gi);
  }
  if (passed == null && files == null) return null;
  return {
    failed: failed ?? 0,
    files,
    passed,
  };
}
function parseLint(out) {
  const clean = stripAnsi(out);
  const summary = clean.match(/Found\s+(\d+)\s+warnings?(?:\s+and\s+(\d+)\s+errors?)?/i);
  if (summary) return { errors: summary[2] ? Number(summary[2]) : 0, warnings: Number(summary[1]) };
  return {
    errors: (clean.match(/\berror\b/gi) || []).length,
    warnings: (clean.match(/\bwarning\b/g) || []).length,
  };
}

// ── audit (faithful: runs the project's OWN audit command) ──────────────────
// Run the audit command exactly as the check chain defines it (same scope /
// --prod / --audit-level), only appending --json for the counts. The gate is
// the command's own exit code, so `check` blocks precisely when a bare
// `<auditCmd>` would — never with a narrower scope than the chain. (The old
// hardcoded `--prod` hid devDependency vulns for library packages.)
/**
 * Was the advisory service actually reachable?
 *
 * Asked ONLY when the audit reported nothing (see `isAuditResultAmbiguous`), because that report
 * is identical whether the tree is clean or the service was down — pnpm fails open and says
 * "0 vulnerabilities" either way, with exit 0 and no error. A clean run then costs one HEAD-ish
 * request; a run with findings costs nothing, because findings already prove it answered.
 *
 * Unreachable is NOT treated as an error here. Offline, behind a proxy, or during an npm outage,
 * "we could not check" is the honest answer — the caller degrades, which warns without blocking.
 *
 * Measured cost, so nobody has to guess at it. A clean repository IS the ambiguous shape, so every
 * healthy run pays one request: 0.67s against a reachable registry. Offline it is 0.07s, not the
 * 8s ceiling — DNS and connection refusals fail immediately, and the timeout only bites on a
 * connection that hangs. The visible cost is therefore the warning, not the wait: from here on an
 * offline check reports "vulnerabilities NOT checked" where it used to show a green audit. That is
 * the point of the change and its main annoyance in the same sentence.
 */
async function advisoryServiceReachable() {
  // The registry pnpm uses, not npmjs.org — see advisoryBulkUrl for why that distinction is
  // the difference between a safeguard and a second false all-clear.
  const url = advisoryBulkUrl(configuredRegistry());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    });
    // Any HTTP answer proves the service is up. A 4xx to an empty body is still an answer.
    return res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Why the audit established nothing — named, because the two causes need different actions.
 *
 * "unreachable" means wait: a foreign service is down and nothing here fixes it. "unreadable" means
 * look here: the command returned success while saying nothing a report could be built from, which
 * is usually local (a version mismatch, a wrapper eating the output). Collapsing both into one
 * message buries the actionable case under the one nobody can act on.
 */
function auditDegradedText(audit) {
  return audit.degradedCause === 'unreadable'
    ? 'exited 0 but emitted no readable result — vulnerabilities NOT checked (look at the audit command itself)'
    : 'could not run — the advisory service was unreachable; vulnerabilities NOT checked';
}

async function runAudit(auditCmd) {
  const cmd = /(^|\s)--json(\s|$)/.test(auditCmd) ? auditCmd : `${auditCmd} --json`;
  const { code, out } = await capture(cmd, ROOT, 0, { NUXT_BUILD_DIR: CHECK_BUILD_DIR });
  let counts = null;
  let unlisted = {};
  let ambiguous = false;
  try {
    const parsed = JSON.parse(out.slice(out.indexOf('{')));
    counts = parsed?.metadata?.vulnerabilities ?? null;
    unlisted = countUnlistedBySeverity(parsed);
    ambiguous = isAuditResultAmbiguous(parsed);
  } catch {
    /* fall through to raw reason */
  }
  // Two different ways an audit fails to establish anything, and they look nothing alike.
  //
  // 1. It errored out. Non-zero exit, no parseable counts, and a known infrastructure signature.
  //    All three required — a non-zero exit on its own stays fatal.
  // 2. It reported a clean tree WITHOUT having reached the advisory service. Exit 0, zero counts,
  //    empty `advisories`, no error — byte-identical to a genuinely clean run, so the report cannot
  //    be asked about itself. The service is probed instead, and only when the result is ambiguous:
  //    a run with findings has proven the service answered.
  // 3. It exited 0 and emitted nothing readable. Not a finding — findings parse. Not a failure —
  //    the exit code says so. It established NOTHING, and it used to render as `✓ audit  0`: the
  //    green tick plus a literal zero, which is the false all-clear in its purest form. Observed:
  //    pnpm answering a version mismatch on stderr with exit 0 and no JSON at all.
  //
  //    Degraded WITHOUT probing, unlike case 2. A reachable service says nothing about a tally
  //    that was never parsed — the probe would answer a question this failure did not ask.
  //
  // The `code !== 0` branch stays FIRST and stays narrow on purpose. Folding these into one
  // `!counts` test is the obvious simplification and it is wrong: it would turn every genuine
  // audit failure into a warning, which is a worse bug than the one being fixed.
  let degradedCause;
  if (code !== 0 && !counts && isAuditEndpointUnavailable(out)) degradedCause = 'unreachable';
  else if (code === 0 && !counts) degradedCause = 'unreadable';
  else if (code === 0 && ambiguous && !(await advisoryServiceReachable())) degradedCause = 'unreachable';
  const degraded = Boolean(degradedCause);
  return {
    auditCmd,
    blocking: code !== 0 && !degraded,
    counts,
    degraded,
    degradedCause,
    reason: counts ? null : out,
    // Read from the workspace, not from the report: a suppressed advisory leaves NOTHING in the
    // JSON that says it was suppressed, so `ignoreGhsas` is the only evidence that a human ever
    // assessed an unlisted finding. Without it, dimming would claim a judgement nobody made.
    suppressions: countSuppressions(ROOT),
    total: sumSeverities(counts),
    unlisted,
  };
}

// Watchdog: kill a TEST step whose child produces NO output for this long. A
// wedged test run (workers idle at 0% CPU — e.g. one spec file grinding through
// retries after its app/socket state broke under load) otherwise spins the live
// view forever: the spinner only proves the child process exists, not that it
// progresses. Only test steps are watched: build / typecheck / audit
// legitimately buffer all their output to the end (and go silent under a
// non-TTY pipe), so watching them would false-kill a slow-but-progressing run.
// Override with --idle-timeout=<seconds> or CHECK_IDLE_TIMEOUT (seconds); 0
// disables it.
const IDLE_TIMEOUT_MS = (() => {
  const flag = process.argv.find((a) => a.startsWith('--idle-timeout='));
  const raw = flag ? flag.slice('--idle-timeout='.length) : process.env.CHECK_IDLE_TIMEOUT;
  const DEFAULT_MS = 300 * 1000;
  if (raw === undefined || raw === '') return DEFAULT_MS;
  const seconds = Number(raw);
  if (seconds === 0) return 0; // explicit opt-out
  // Invalid value (typo, unit suffix, negative) → keep the protection at its
  // default rather than silently disabling it.
  if (!Number.isFinite(seconds) || seconds < 0) {
    process.stderr.write(`[check] ignoring invalid idle-timeout "${raw}", using ${DEFAULT_MS / 1000}s\n`);
    return DEFAULT_MS;
  }
  return seconds * 1000;
})();

// ── command runner ─────────────────────────────────────────────────────────
const RUNNING = new Set();

// Best-effort kill of a child's whole process tree (sh → pnpm → vitest →
// fork workers). Killing only the direct child orphans the tree — exactly the
// zombie workers a deadlock leaves behind. Children are collected via pgrep
// and killed leaves-first.
function killTree(child, signal = 'SIGTERM') {
  const pids = [];
  const collect = (pid) => {
    pids.push(pid);
    let out = '';
    try {
      out = execSync(`pgrep -P ${pid}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      /* no children */
    }
    if (out) for (const p of out.split('\n')) collect(Number(p));
  };
  collect(child.pid);
  for (const pid of pids.reverse()) {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

// idleTimeoutMs > 0 arms the no-output watchdog for this child; 0 (the default)
// runs it unwatched. Only callers that KNOW the child streams progress (test
// steps) should pass a timeout — see runGroup.
function capture(cmd, cwd, idleTimeoutMs = 0, extraEnv = null) {
  return new Promise((resolve) => {
    // `extraEnv` carries the build-dir pin as a real environment variable IN
    // ADDITION to the textual prefix. A `VAR=value cmd` prefix binds only to the
    // first simple command, so a step written with `;` or a leading `cd` would be
    // reported as pinned and run unpinned. The env reaches every command in the
    // string, and the prefix still wins where both apply (same value).
    const child = spawn(cmd, {
      cwd,
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      shell: true,
    });
    RUNNING.add(child);
    let out = '';
    let idleTimer = null;
    let killTimer = null;
    let watchdogHit = false;
    // Any output resets the watchdog — only complete silence for the full
    // window counts as wedged. Escalate to SIGKILL for processes that ignore
    // SIGTERM.
    const armWatchdog = () => {
      if (!idleTimeoutMs) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        watchdogHit = true;
        killTree(child);
        killTimer = setTimeout(() => killTree(child, 'SIGKILL'), 5000);
        killTimer.unref();
      }, idleTimeoutMs);
    };
    const onData = (d) => {
      out += d;
      armWatchdog();
      if (VERBOSE) process.stdout.write(d);
    };
    armWatchdog();
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const done = (code, extra) => {
      clearTimeout(idleTimer);
      clearTimeout(killTimer);
      RUNNING.delete(child);
      if (watchdogHit) {
        const note =
          `[watchdog] step produced no output for ${Math.round(idleTimeoutMs / 1000)}s — ` +
          'process tree killed as deadlocked. This is a hang (workers idle at 0% CPU), ' +
          `not a slow run. Re-run the step directly to debug: \`${cmd}\``;
        return resolve({ code: 1, out: `${out}\n${note}` });
      }
      resolve({ code, out: extra ? `${out}\n${extra}` : out });
    };
    child.on('close', (code) => done(code ?? 1));
    child.on('error', (err) => done(1, err.message));
  });
}
function killAll() {
  for (const child of RUNNING) {
    try {
      killTree(child);
    } catch {
      /* already gone */
    }
  }
}

// A child killed by a signal surfaces through the package manager as a
// "Command failed with exit code 143/137" line (SIGTERM/SIGKILL), NOT as a test
// assertion failure — and the outer shell then reports its own generic exit 1,
// so `code` alone never reveals it. Surface the signal so the reason isn't
// mistaken for a real failure: the usual cause is resource pressure (parallel
// checks/builds swapping the machine) or an external kill.
function signalExitHint(out) {
  const clean = stripAnsi(out);
  // The watchdog also kills via SIGTERM, so pnpm's "exit code 143" ends up in
  // the output — but that path already carries its own [watchdog] note with the
  // correct (deadlock) diagnosis. Don't stack a contradictory "external kill"
  // hint on top of it.
  if (/\[watchdog\]/.test(clean)) return null;
  const m = clean.match(/Command failed with exit code (137|143)\b/);
  if (!m) return null;
  const sig = m[1] === '143' ? 'SIGTERM' : 'SIGKILL';
  return (
    `[check] step ended via ${sig} (exit ${m[1]}) — the process was killed, not an assertion failure. ` +
    'Usual cause: resource pressure (parallel checks/builds swapping) or an external kill. ' +
    "Re-run this project's check alone to confirm."
  );
}

// ── live multi-line status (one line per running project) ────────────────────
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let liveCount = 0;
let frame = 0;
function drawLive(lines) {
  if (!TTY) return;
  if (liveCount > 0) process.stdout.write(`\x1b[${liveCount}A`);
  for (const l of lines) process.stdout.write(`\r\x1b[K${l}\n`);
  liveCount = lines.length;
}
function statusLines(order, states) {
  frame += 1;
  return order.map((rel) => {
    const s = states.get(rel);
    if (s.failed) return `${C.red('✗')} ${shortRel(rel).padEnd(5)} ${C.red(`${s.failed} FAILED`)}`;
    if (s.done) return `${C.green('✓')} ${shortRel(rel).padEnd(5)} ${C.dim(`done (${fmtDuration(s.total)})`)}`;
    const spin = C.cyan(FRAMES[frame % FRAMES.length]);
    const el = s.stepStart ? C.dim(` (${fmtDuration(Date.now() - s.stepStart)})`) : '';
    return `${spin} ${shortRel(rel).padEnd(5)} ${s.current || 'queued'}${el}`;
  });
}

// ── project discovery + step grouping ────────────────────────────────────────
const IS_ORCHESTRATOR = (script) => !script || script.includes('check.mjs');

/**
 * True when a command re-enters `check` across workspace members.
 *
 * Such a command must be stripped from the root chain: this wrapper ALREADY
 * runs every member as its own group, so letting the fan-out through runs them
 * a second time — and, because the root group runs under the same
 * `Promise.all`, CONCURRENTLY with the wrapper's own member groups. That means
 * two `pnpm install` against one node_modules (exactly what the install hoist
 * exists to prevent), two builds writing the same build dir, and two API e2e
 * suites sharing one database.
 *
 * A positive test for "re-enters check", not a match on one spelling: `run` is
 * optional in pnpm (`pnpm -r check`), the scope may be given as `--filter`
 * rather than `-r`, and npm/yarn/turbo/lerna/nx each spell it differently. The
 * previous version required a literal `pnpm … run check` and let every other
 * form survive.
 */
export function isRecursiveCheck(cmd) {
  const c = cmd.toLowerCase();
  if (!/\bcheck\b/.test(c)) return false;
  // Fans out over workspace members. NOTE the `(?:^|\s)` rather than `\b`: there
  // is no word boundary between a space and a `-`, so `\b-r` never matches
  // anything — the flag forms have to be anchored on whitespace.
  if (/(?:^|\s)(?:-r|--recursive|--filter\S*|--workspaces?|foreach)(?:\s|=|$)/.test(c)) {
    return true;
  }
  // … or delegates to a monorepo task runner, which does the same.
  return /(?:^|\s)(?:turbo|lerna|nx)(?:\s|$)/.test(c);
}

/** True when this command is hoisted to a single workspace-level run. */
function isHoisted(cmd) {
  const kind = classify(cmd).kind;
  return kind === 'install' || kind === 'audit';
}

// Workspace discovery lives in ./lib/workspace-packages.mjs — one reader shared with
// check-workspace-consistency.mjs and check-ci-consistency.mjs. It had been copied into
// all three and the copies had already drifted; the shared one also counts SYMLINKED
// members, which `lt fullstack init --api-link/--frontend-link` creates and which a
// plain `isDirectory()` filter reported as absent, making a linked workspace look empty.
const workspaceGlobs = () => readWorkspaceGlobs(ROOT);
const expandGlob = (glob) => expandWorkspaceGlob(ROOT, glob);

function asProject(rel, check) {
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(rel === '.' ? join(ROOT, 'package.json') : join(ROOT, rel, 'package.json'), 'utf8'));
  } catch {
    /* keep defaults */
  }
  return { check, dir: rel === '.' ? ROOT : join(ROOT, rel), name: pkg.name || rel, rel };
}

// Workspace sub-projects and their real check chain; if there are none (a
// single-package repo), fall back to the root project — whose real chain lives
// in `check:raw`, because the root `check` is THIS wrapper.
//
// A member's `check` is frequently THIS wrapper too: the lt starters ship their
// own scripts/check.mjs so they also work standalone (`lt server create`), and
// `lt fullstack init` clones them verbatim into projects/*. Treating that as
// "no real chain" silently dropped EVERY member — the run then fell back to the
// root, whose chain is just `pnpm -r run check`, and reported the whole
// monorepo as one opaque step with "no test step / 0 passed" while the members'
// tests were in fact running, unseen. So resolve a member exactly like the root:
// wrapper `check` means the real chain lives in `check:raw`.
function realChain(pkg) {
  if (!IS_ORCHESTRATOR(pkg.scripts?.check)) return pkg.scripts?.check ?? null;
  return pkg.scripts?.['check:raw'] ?? null;
}

function discoverProjects() {
  const projects = [];
  for (const glob of workspaceGlobs()) {
    for (const rel of expandGlob(glob)) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(join(ROOT, rel, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      const chain = realChain(pkg);
      if (chain) projects.push(asProject(rel, chain));
    }
  }
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const rootChain = root.scripts?.['check:raw'] ?? (IS_ORCHESTRATOR(root.scripts?.check) ? null : root.scripts?.check);
  if (projects.length === 0) {
    if (rootChain) projects.push(asProject('.', rootChain));
  } else if (rootChain) {
    // With members present, the root's own chain must not be dropped: beyond
    // install/audit (hoisted later) and the member fan-out (replaced by the
    // member expansion above) it may carry root-ONLY steps — in the assembled
    // monorepo that is `check:workspace` / `check:pin`, which exist precisely
    // for the case where members are present. Strip the fan-out command and
    // keep whatever remains as a root project.
    const ownSteps = rootChain
      .split('&&')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((c) => !isRecursiveCheck(c));
    // Only when something is actually LEFT: a chain that reduces to nothing but
    // hoisted steps would otherwise add an empty group that occupies a live-view
    // row and reports a phantom success it never earned.
    if (ownSteps.some((c) => !isHoisted(c))) {
      projects.unshift(asProject('.', ownSteps.join(' && ')));
    }
  }
  if (PROJECT_FILTERS.length)
    return projects.filter((p) => PROJECT_FILTERS.some((f) => p.rel.includes(f) || p.name.includes(f)));
  return projects;
}

// One group per project: its ordered, fix-mapped steps. The audit step is
// hoisted to a single workspace-level run; its EXACT command (scope + level +
// package manager) is captured so the run mirrors the chain's own audit.
export function buildGroups(projects) {
  let auditCmd = null;
  let installCmd = null;
  const groups = projects.map((project) => {
    const steps = [];
    for (const raw of project.check
      .split('&&')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const meta = classify(raw);
      const pinned = pinCheckBuildDir(raw);
      // Both kinds are hoisted to ONE workspace-level run and every further
      // occurrence is dropped — deliberately, and regardless of how it is
      // spelled: in a pnpm workspace each member's install resolves the whole
      // workspace anyway, so a second one is redundant, and running two
      // concurrently races on the same node_modules. The same holds for the
      // audit, which is a workspace-wide question.
      //
      // This is safe to drop silently ONLY because `classify` now hoists just
      // the real `<pm> install` / `<pm> audit` forms. A project script that
      // merely mentions audit in its name stays an ordinary step, so a chain can
      // no longer lose a gate here without a trace.
      if (meta.kind === 'audit') {
        if (!auditCmd) auditCmd = pinned;
        continue;
      }
      if (meta.kind === 'install') {
        if (!installCmd) installCmd = pinned;
        continue;
      }
      // Pinned here TOO, not only on the two hoists. classify() routes every
      // install and audit into a hoist, so for those this is redundant — but the
      // step list also carries the non-hoisted remainder above, and both layers
      // are idempotent (pinCheckBuildDir never double-prefixes and never
      // overrides an existing pin), so defending it costs nothing.
      steps.push({
        ...meta,
        cmd: pinCheckBuildDir(toFixCommand(meta.kind, raw)),
        cwd: project.dir,
      });
    }
    return { project, steps };
  });
  return { auditCmd, groups, installCmd };
}

// ── per-project runner ───────────────────────────────────────────────────────
// Runs a group's steps in order, recording results + live state. Stops early
// when another project already failed (abort.hit). The `gate` keeps CPU-heavy
// steps (build, typecheck) from overlapping a contention-sensitive test suite
// across groups (DEV-2524, cause 2) — see build-test-gate.mjs.
async function runGroup(group, states, results, abort, gate) {
  const rel = group.project.rel;
  const st = states.get(rel);
  const startedAt = Date.now();
  for (const step of group.steps) {
    if (abort.hit) return;
    // A parallel `nuxt build` saturating the machine tips the API e2e suite's
    // Better-Auth session validation into intermittent 401/500 (DEV-2524). Hold
    // the two-class gate so heavy CPU work and a sensitive test suite never
    // overlap across groups; same-class steps still run concurrently and every
    // other step kind ignores the gate entirely.
    const klass = gateClass(step);
    let waited = 0;
    if (klass) {
      const queuedAt = Date.now();
      st.current = `${step.label} (queued)`;
      st.stepStart = queuedAt;
      // Surface the wait in CI too: the step line below is only printed AFTER
      // the acquire, so a gate-blocked group would otherwise emit nothing at all
      // for the length of a full build and read like a hang.
      if (!TTY) process.stdout.write(`  ${C.dim('⋯')} ${shortRel(rel)} · ${step.label} ${C.dim('(queued)')}\n`);
      await gate.acquire(klass);
      waited = Date.now() - queuedAt;
      // Another group may have failed while we waited — abort before starting.
      //
      // Not raced against an abort signal on purpose: the fatal path calls
      // killAll(), which terminates the holder's process tree, so its capture()
      // resolves, its finally releases, and this waiter is admitted within
      // milliseconds. Racing would hand the queue a waiter that never releases
      // its slot, which is the one way to actually deadlock the opposite class.
      if (abort.hit) {
        gate.release();
        return;
      }
    }
    st.current = step.label;
    st.stepStart = Date.now();
    if (!TTY) process.stdout.write(`  ${C.dim('→')} ${shortRel(rel)} · ${step.label}\n`);
    // Watchdog on every GATED step, not just tests. A test runner streams output
    // continuously, so prolonged silence == deadlocked workers; a build is
    // normally left unwatched because it buffers. But a gated build holds a slot
    // that blocks every test step in every other group, so a wedged one now
    // hangs the whole run rather than just its own chain — it needs the same
    // watchdog. Ungated steps still run unwatched.
    const watch = step.kind === 'test' || klass ? IDLE_TIMEOUT_MS : 0;
    let code;
    let out;
    try {
      ({ code, out } = await capture(step.cmd, step.cwd, watch, stepEnv(step)));
    } finally {
      // Release on every exit path — normal completion or the fatal-failure
      // return below. A leaked slot would deadlock the opposite class under
      // Promise.all.
      if (klass) gate.release();
    }
    const dur = Date.now() - st.stepStart;
    const r = { dur, kind: step.kind, label: step.label, project: rel };
    // Recorded separately from `dur`: the report must not hide where the
    // wall-clock went. A step that waited 8 minutes behind another group's build
    // and then ran for 2 is not a 2-minute step.
    if (waited > 0) r.waited = waited;
    if (step.kind === 'test') r.tests = parseVitest(out);
    if (step.kind === 'lint') r.lint = parseLint(out);
    results.push(r);
    if (code !== 0 && step.fatal) {
      st.failed = step.label;
      if (!abort.hit) {
        abort.hit = true;
        const hint = signalExitHint(out);
        abort.failure = {
          out: hint ? `${out}\n${hint}` : out,
          project: rel,
          step: `${shortRel(rel)} · ${step.label}`,
        };
        killAll();
      }
      return;
    }
    if (!TTY)
      process.stdout.write(
        `  ${C.green('✓')} ${shortRel(rel)} · ${step.label}${metricSuffix(r)} ${C.dim(`(${fmtDuration(dur)})`)}\n`,
      );
  }
  st.done = true;
  st.total = Date.now() - startedAt;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const started = Date.now();
  const projects = discoverProjects();
  if (projects.length === 0) {
    console.error(C.red('No workspace projects with a `check` script found.'));
    process.exit(1);
  }
  const { auditCmd, groups, installCmd } = buildGroups(projects);
  const stepCount = groups.reduce((n, g) => n + g.steps.length, 0) + (auditCmd ? 1 : 0) + (installCmd ? 1 : 0);
  const mode = SEQUENTIAL ? 'sequential' : 'parallel';
  const pkgName = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name;

  console.log(C.bold(`\nRunning checks for ${C.cyan(pkgName)}`));
  console.log(
    C.dim(
      `${projects.length} project(s) · ${stepCount} steps · ${mode} · audit: ${auditCmd ?? 'none'}` +
        `${NO_FIX ? '' : ' · auto-fix format+lint'}${VERBOSE ? ' · verbose' : ''}\n`,
    ),
  );

  const results = [];

  // Step -1 — single hoisted workspace install (before audit and fan-out).
  // The member chains each start with their own `pnpm install --frozen-lockfile`;
  // running it ONCE at the workspace root is equivalent and removes the race of
  // two parallel installs mutating the same node_modules.
  if (installCmd) {
    const t = Date.now();
    if (!TTY) process.stdout.write(`  ${C.dim('→')} install\n`);
    else drawLive([`${C.cyan(FRAMES[0])} install`]);
    const { code, out } = await capture(installCmd, ROOT, 0, { NUXT_BUILD_DIR: CHECK_BUILD_DIR });
    const dur = Date.now() - t;
    if (code !== 0) {
      liveCount = 0; // the failure line must survive — nothing may overwrite it
      console.log(`${C.red('✗')} install ${C.dim(`(${fmtDuration(dur)})`)}`);
      return fail(`install (${installCmd})`, out, started);
    }
    if (!TTY) process.stdout.write(`  ${C.green('✓')} install ${C.dim(`(${fmtDuration(dur)})`)}\n`);
    // TTY success: no permanent line — see the audit block below.
    results.push({ dur, kind: 'step', label: 'install', project: '.' });
  }

  // Step 0 — single workspace audit (blocking gate, runs before the fan-out).
  // Mirrors the chain's own audit command (scope/level/PM); skipped only when
  // the chain has no audit step.
  if (auditCmd) {
    const t = Date.now();
    if (!TTY) process.stdout.write(`  ${C.dim('→')} audit\n`);
    else drawLive([`${C.cyan(FRAMES[0])} audit`]);
    const audit = await runAudit(auditCmd);
    const dur = Date.now() - t;
    if (audit.blocking) {
      liveCount = 0; // the failure line must survive — nothing may overwrite it
      const summary = audit.counts ? `${audit.total} vuln (${renderVulnLine(audit)})` : 'failed';
      console.log(`${C.red('✗')} audit  ${C.red(summary)} ${C.dim(`(${fmtDuration(dur)})`)}`);
      return fail(`audit (${auditCmd})`, audit.counts ? renderVulnLine(audit) : audit.reason, started);
    }
    if (audit.degraded) {
      // Loud, and never rendered as a tick. A green ✓ here would claim "no vulnerabilities",
      // which is exactly what was NOT established — the service could not be reached. The run
      // continues because an outage is not a finding and nothing in this repo fixes it.
      liveCount = 0;
      console.log(`${C.yellow('⚠')} audit  ${C.yellow(auditDegradedText(audit))} ${C.dim(`(${fmtDuration(dur)})`)}`);
    }
    // `!audit.degraded`: the warning above already printed, and a ✓ underneath it would say
    // "no vulnerabilities" about a run that established nothing.
    if (!TTY && !audit.degraded) {
      process.stdout.write(
        `  ${C.green('✓')} audit  ${audit.counts ? renderVulnLine(audit) : C.dim('0')} ${C.dim(`(${fmtDuration(dur)})`)}\n`,
      );
    }
    // TTY success: NO permanent line — the live status view overwrites the audit
    // row (like every other step); the result lands in the report twice: the
    // Steps list (entry below) and the Vulnerabilities section.
    results.push({ audit, kind: 'audit' });
    results.push({ dur, kind: 'step', label: 'audit', project: '.' });
  }

  // Per-project steps — parallel by default, serial with --sequential.
  const order = groups.map((g) => g.project.rel);
  const states = new Map(order.map((rel) => [rel, { current: 'queued' }]));
  const abort = { failure: null, hit: false };
  // Serializes CPU-heavy `build` steps against the contention-sensitive `test`
  // suites across groups so a parallel `nuxt build` can never destabilize the
  // API-e2e run (DEV-2524). Inert in --sequential mode (steps never overlap).
  const gate = createBuildTestGate();
  const ticker = TTY ? setInterval(() => drawLive(statusLines(order, states)), 80) : null;
  if (TTY) drawLive(statusLines(order, states));

  if (SEQUENTIAL) {
    for (const g of groups) {
      await runGroup(g, states, results, abort, gate);
      if (abort.hit) break;
    }
  } else {
    await Promise.all(groups.map((g) => runGroup(g, states, results, abort, gate)));
  }

  if (ticker) clearInterval(ticker);
  if (TTY) drawLive(statusLines(order, states)); // final frame

  if (abort.hit) return fail(abort.failure.step, abort.failure.out, started);

  report(started, results);
  process.exit(0);
}

// ── rendering helpers ─────────────────────────────────────────────────────────

function metricSuffix(r) {
  if (r.kind === 'test' && r.tests?.passed != null) {
    const failed = r.tests.failed ? C.red(` / ${r.tests.failed} failed`) : '';
    return `  ${C.dim(`${r.tests.passed} passed${r.tests.files != null ? ` / ${r.tests.files} files` : ''}`)}${failed}`;
  }
  if (r.waited != null && r.waited >= 1000) {
    // The gate wait is NOT part of `dur`, so without this the report would show
    // a two-minute step that actually occupied ten minutes of wall-clock.
    return `  ${C.dim(`queued ${fmtDuration(r.waited)}`)}`;
  }
  if (r.kind === 'lint' && r.lint) {
    return r.lint.warnings > 0
      ? `  ${C.yellow(`${r.lint.warnings} warning${r.lint.warnings === 1 ? '' : 's'}`)}`
      : `  ${C.dim('clean')}`;
  }
  return '';
}

function fail(stepLabel, reason, started) {
  console.log(`\n${C.red(`──── reason · ${stepLabel} ────`)}`);
  console.log(stripAnsi(String(reason)).trimEnd().split('\n').slice(-40).join('\n'));
  console.log(C.red('────────────────────────────────────────\n'));
  console.log(C.bold(C.red(`✗ Check FAILED at step "${stepLabel}" after ${fmtDuration(Date.now() - started)}.`)));
  console.log(C.dim('Re-run with --verbose for the full output of every step.'));
  process.exit(1);
}

function report(started, results) {
  const audit = results.find((r) => r.kind === 'audit')?.audit;
  const tests = results.filter((r) => r.kind === 'test');
  const unit = tests.find((r) => r.project?.includes('app'))?.tests;
  const api = tests.find((r) => r.project?.includes('api'))?.tests;
  const totalPassed = tests.reduce((n, r) => n + (r.tests?.passed || 0), 0);

  const bar = '═'.repeat(52);
  console.log(`\n${C.green(bar)}`);
  console.log(C.bold(`  ${C.green('✓ Check PASSED')}  ${C.dim(`(${fmtDuration(Date.now() - started)})`)}`));
  console.log(C.green(bar));

  console.log(`\n${C.bold('Steps')}`);
  const steps = results.filter((x) => x.kind !== 'audit');
  // Group by project when more than one is involved: workspace-level steps
  // (hoisted install/audit, root-only checks) under "monorepo", then one block
  // per member. Steps within a project run sequentially, so per-group order is
  // chain order. A single-project run keeps the flat list — a header is noise.
  const stepGroups = [...new Set(steps.map((r) => r.project))].sort((a, b) =>
    a === '.' ? -1 : b === '.' ? 1 : shortRel(a).localeCompare(shortRel(b)),
  );
  if (stepGroups.length > 1) {
    for (const project of stepGroups) {
      console.log(`  ${C.bold(project === '.' ? 'monorepo' : shortRel(project))}`);
      for (const r of steps.filter((x) => x.project === project)) {
        console.log(
          `    ${C.green('✓')} ${r.label.padEnd(24)}${metricSuffix(r) || '  '} ${C.dim(`(${fmtDuration(r.dur)})`)}`,
        );
      }
    }
  } else {
    for (const r of steps) {
      console.log(
        `  ${C.green('✓')} ${`${shortRel(r.project)} · ${r.label}`.padEnd(26)}${metricSuffix(r) || '  '} ${C.dim(`(${fmtDuration(r.dur)})`)}`,
      );
    }
  }

  console.log(`\n${C.bold('Vulnerabilities')} ${C.dim(audit ? `(${audit.auditCmd})` : '(no audit step)')}`);
  console.log(
    `  ${
      audit?.counts
        ? renderVulnLine(audit)
        : audit?.degraded
          ? // Named, not blank. "counts unavailable" reads like a formatting hiccup; the reader
            // has to know the tree was never checked, or a green summary above means more than
            // it should.
            C.yellow(auditDegradedText(audit))
          : C.dim(audit ? 'counts unavailable' : '—')
    }`,
  );

  console.log(`\n${C.bold('Tests')}`);
  if (unit || api) {
    // Monorepo with app and/or api projects → the canonical area breakdown.
    console.log(`  ${'Unit (app)'.padEnd(18)}${unit?.passed != null ? `${unit.passed} passed` : C.dim('—')}`);
    console.log(`  ${'API (api)'.padEnd(18)}${api?.passed != null ? `${api.passed} passed` : C.dim('—')}`);
    console.log(`  ${'Playwright'.padEnd(18)}${C.dim('— (run via `lt dev test` / CI)')}`);
  } else {
    // Single-package repo → one line per test-bearing project.
    for (const r of tests)
      console.log(
        `  ${shortRel(r.project).padEnd(18)}${r.tests?.passed != null ? `${r.tests.passed} passed` : C.dim('—')}`,
      );
    if (tests.length === 0) console.log(`  ${C.dim('no test step')}`);
  }
  console.log(`  ${C.bold('Total'.padEnd(18))}${C.bold(`${totalPassed} passed`)}`);

  console.log(`\n${C.green('All checks passed.')}\n`);
}

// Run only when invoked as the CLI (`node scripts/check.mjs`). Importing this
// module must never kick off a full check run — a sibling test does exactly
// that to assert the pure helpers, where the project has one. (Do not name a
// specific test file here: a project scaffolded by `lt fullstack init` ships
// one, a project migrated by `lt fullstack update` does not, and naming it
// tells half the readers to look for something that was never installed.)
//
// Split into a pure DECISION and its side effect on purpose. With the
// `process.exit(1)` inlined, the fail-closed branch was unreachable from a test
// (it would take the test process down with it), so nothing caught a regression
// that turned it into a silent `return false` — which is exactly the "green gate
// that never ran" this guard exists to prevent.
export function resolveCliEntry(entry = process.argv[1], self = fileURLToPath(import.meta.url)) {
  if (!entry) return { isEntry: false };
  try {
    return { isEntry: realpathSync(entry) === realpathSync(self) };
  } catch (err) {
    // "Cannot tell" is NOT "not the entry" — the caller must fail closed.
    return { isEntry: false, unresolvable: err };
  }
}

function isCliEntry() {
  const { isEntry, unresolvable } = resolveCliEntry();
  if (unresolvable) {
    // Fail CLOSED. Treating this as "not the CLI" would make `node
    // scripts/check.mjs` print nothing and exit 0 — a green gate that never ran.
    process.stderr.write(
      `[check] cannot resolve the CLI entry (${unresolvable?.code || unresolvable}) — refusing to report success\n`,
    );
    process.exit(1);
  }
  return isEntry;
}

if (isCliEntry()) {
  // Never leave the child tree behind. Without this, Ctrl-C or a crash detaches
  // every running `pnpm test` / build / e2e fork pool: they keep the test
  // database and ports held, and the next run fails for a reason that has
  // nothing to do with the code.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      killAll();
      // Conventional 128+n, and it makes the interruption distinguishable from
      // an ordinary failure.
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
  main().catch((err) => {
    killAll();
    console.error(C.red(`\ncheck.mjs crashed: ${err?.stack || err}`));
    process.exit(1);
  });
}
