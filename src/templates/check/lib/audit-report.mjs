/**
 * Audit summary accounting and rendering.
 *
 * Lives in its own module so a test can import these functions. `check.mjs` calls `main()` at
 * module scope, so importing IT would run the whole check as a side effect. The alternative —
 * exporting from `check.mjs` behind an `import.meta.url === argv[1]` entry-point guard — was
 * rejected deliberately: when such a guard mis-fires (a symlinked bin, a `realpath` difference)
 * `check.mjs` becomes a silent no-op that exits 0, which is a permanently green gate that runs
 * nothing. A wrong display is worth less than a wrong gate.
 */

/*
 * Deliberately NOT the same shape as nest-server's, and that is worth knowing before "fixing" it.
 *
 * nest-server's `scripts/check.mjs` solves the same problem the other way round: it DERIVES the
 * displayed counts from `advisories` and reports a separate `ignored` total, so its line reads
 * "high 0" plus "1 ignored". Here (and in nuxt-extensions) the raw tally stays authoritative and
 * the gap is reported beside it as `unlisted`. Both avoid the original defect — a green check
 * printed next to a permanent "high 1" — and both are guarded against the missing `advisories`
 * key. The labels differ accordingly (`ignored` there, `not listed` here).
 *
 * Two designs, one concern, on purpose: nest-server's display is its own and was hardened rather
 * than swapped out, because rewriting a sibling repo's report format is a bigger change than the
 * bug being fixed. If the two are ever unified, unify them deliberately — the difference is a
 * decision, not drift.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { C } from './ansi.mjs';

export const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

/** Sum a `metadata.vulnerabilities`-shaped object across the severities we report. */
export function sumSeverities(counts) {
  return SEVERITIES.reduce((n, s) => n + (counts?.[s] || 0), 0);
}

/**
 * The audit could not RUN — as opposed to running and finding vulnerabilities.
 *
 * The difference decides whether `check` blocks. A finding is something a person can act on; an
 * unreachable advisory service is not, and no version bump fixes it. Blocking on the latter paints
 * every run red for an outage nobody can do anything about, which is how people learn to ignore a
 * red audit — the one failure mode an audit gate cannot survive.
 *
 * Note this does NOT weaken `.gitlab-ci.yml`'s documented stance that a red audit job must block.
 * That rule is about ADVISORIES ("a red audit means a NEW advisory nobody has assessed yet"), and
 * it still holds: a real finding always yields parseable `metadata`/`advisories` and stays fatal.
 * "The service was unreachable" was never the case that rule was written about.
 *
 * Deliberately a SIGNATURE match, never "the output did not parse". The loose rule would also
 * swallow a genuine audit failure whose output merely happens to be unparseable, and then the gate
 * would be green for a reason nobody chose. Callers ask only after failing to parse counts.
 */
export function isAuditEndpointUnavailable(out) {
  // 1. npm retired `/-/npm/v1/security/audits/quick` and `/audits` (both 410) while pnpm still
  //    called them. Every project everywhere exited non-zero with nothing reported.
  if (/ERR_PNPM_AUDIT_BAD_RESPONSE/.test(out) || (/\baudit\b/i.test(out) && /\bretired\b/i.test(out))) {
    return true;
  }

  // 2. The WORKING bulk endpoint failing transiently. Observed 2026-09-04:
  //    `registry.npmjs.org` answered 200 in 0.24s while
  //    `/-/npm/v1/security/advisories/bulk` timed out, and pnpm surfaced its own envelope:
  //
  //      {"error":{"code":23,"message":"The operation was aborted due to timeout"}}
  //
  //    It reded the check in nest-server, nest-server-starter and nuxt-extensions inside one hour.
  //    Matched on the envelope rather than on the exit code, so an auth failure (401/403) or a
  //    malformed request stays fatal — those are configuration, not weather.
  let envelope;
  try {
    envelope = JSON.parse(out.slice(out.indexOf('{')))?.error;
  } catch {
    envelope = undefined;
  }
  if (envelope) {
    const errorCode = envelope.code;
    const errorMessage = String(envelope.message ?? '');

    // Authentication and authorization are CONFIGURATION, never weather — and they must keep
    // blocking. Checked first and explicitly, because the word list below would otherwise degrade
    // them on a coincidence: `401 Unauthorized: session timeout` and `403 Forbidden, request
    // aborted` both matched, which silently tolerates a broken registry credential. A misconfigured
    // token that reports "vulnerabilities not checked" forever is worse than one that fails loudly.
    if (errorCode === 401 || errorCode === 403 || /^\s*(unauthorized|forbidden)\b/i.test(errorMessage)) {
      return false;
    }

    // A 5xx is read from the numeric CODE only. Matching `\b5\d\d\b` in free text degraded on any
    // number in that range that happened to appear in a message — `audited 503 packages` was enough.
    if (typeof errorCode === 'number' && errorCode >= 500 && errorCode < 600) return true;

    const message = `${errorCode ?? ''} ${errorMessage}`;
    // `fetch failed` is undici's generic transport error, and it is what pnpm actually surfaces
    // when the registry connection is refused — measured 2026-09-04 against an unreachable
    // registry: `{"error":{"code":"pnpm","message":"fetch failed"}}`. It was missing here, because
    // this list was assembled from the observed TIMEOUT case alone and never tested against a
    // refusal. Widening is safe: the list is consulted ONLY on an `error` envelope, and a real
    // audit report carries no `error` key — so no advisory whose title mentions a timeout or a
    // failed fetch can reach this test.
    return /\btimeout\b|\baborted\b|fetch failed|socket hang up|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN/i.test(
      message,
    );
  }
  return false;
}

/**
 * The advisory endpoint of the registry pnpm ACTUALLY uses — not of npmjs.org.
 *
 * The probe that resolves an ambiguous audit has to ask the same service the audit asked. Pointing
 * it at `registry.npmjs.org` while pnpm resolves against a private registry or a proxy reproduces
 * the exact bug it exists to prevent, one layer deeper: pnpm fails silently against the configured
 * registry, the probe asks npmjs.org, npmjs.org answers, and the run reports a green tick. A
 * false all-clear inside the safeguard against false all-clears.
 *
 * Kept pure and separate from the lookup so a test can reach it. `registry` is whatever
 * `pnpm config get registry` returns, trailing slash or not.
 */
export function advisoryBulkUrl(registry) {
  const base = String(registry || '').trim() || 'https://registry.npmjs.org';
  return `${base.replace(/\/+$/, '')}/-/npm/v1/security/advisories/bulk`;
}

/**
 * What `pnpm config get registry` reports, or npmjs.org when that cannot be asked.
 *
 * Falling back rather than failing: an unreadable pnpm config is not a reason to skip the check,
 * and the default is what pnpm itself would use.
 */
export function configuredRegistry(env = process.env) {
  // Environment FIRST, and this order is not cosmetic. pnpm honours `npm_config_registry` for the
  // audit itself, but `pnpm config get registry` does NOT report it — measured 2026-09-04:
  //
  //   npm_config_registry=http://127.0.0.1:9/ pnpm audit               uses 127.0.0.1:9, fails
  //   npm_config_registry=http://127.0.0.1:9/ pnpm config get registry https://registry.npmjs.org/
  //
  // Asking pnpm alone therefore points the probe at npmjs.org while the audit talked to somewhere
  // else. npmjs.org answers, the run concludes "no outage", and the green tick is back — the same
  // false all-clear as a hardcoded URL, one layer further in. Found by nuxt-extensions-f7, whose
  // end-to-end test was green and should not have been.
  const fromEnv = env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();

  try {
    return execSync('pnpm config get registry', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'https://registry.npmjs.org';
  }
}

/**
 * What the CI audit gate should DO, given one audit attempt.
 *
 * Extracted so a test can reach it. It used to live inline in `check-audit.mjs`, where the only way
 * to exercise it was to run a real `pnpm audit` — which means the branch that decides whether a
 * security gate passes was, in practice, never tested. That is the shape this whole module exists
 * to argue against.
 *
 * `serviceReachable` is passed in rather than probed here: the probe is I/O, the decision is not,
 * and a decision that cannot be tested without a network is not much better than one that cannot be
 * tested at all. Callers pass `undefined` when they have not asked — only the `ambiguous` verdict
 * needs the answer.
 *
 * Verdicts:
 *   'degraded-unreachable'  the service could not be asked — warn, do not block
 *   'degraded-unreadable'   exit 0 with nothing parseable — warn, do not block, look locally
 *   'fail'                  a real failure, or real findings — block
 *   'ok'                    clean AND the service confirmed it answered
 *   'ask-service'           ambiguous, the caller must probe and call again with the answer
 */
export function auditVerdict({ code, out, parsed, serviceReachable, timedOut }) {
  const counts = parsed?.metadata?.vulnerabilities ?? null;

  // A hang and a known infrastructure signature are the same fact: it could not run.
  if (timedOut || (code !== 0 && !counts && isAuditEndpointUnavailable(out))) return 'degraded-unreachable';

  // Checked BEFORE the readability test and kept narrow: a non-zero exit without an infrastructure
  // signature is a real failure and must block. Folding this together with the `!counts` case below
  // is the obvious simplification and it would turn every genuine audit failure into a warning.
  if (code !== 0) return 'fail';

  // Exit 0 with nothing parseable. Not a finding (findings parse), not a failure (the exit says so),
  // and it established nothing — it used to render as a green tick beside a literal `0`.
  if (!counts) return 'degraded-unreadable';

  if (isAuditResultAmbiguous(parsed)) {
    if (serviceReachable === undefined) return 'ask-service';
    return serviceReachable ? 'ok' : 'degraded-unreachable';
  }

  // Exit 0 with a readable, unambiguous report: pnpm looked and did not object. NOT re-judged by
  // counting severities here — a count above zero with exit 0 is precisely what `--audit-level`
  // means, and blocking on it would make this gate STRICTER than a bare `pnpm audit`. Both
  // `.gitlab-ci.yml` and `check.mjs` state the opposite as the contract: the gate blocks exactly
  // when the bare command would, never on a threshold this wrapper invented. Real findings arrive
  // as a non-zero exit and are caught above.
  return 'ok';
}

/**
 * True when the report is indistinguishable from "the service was never reached".
 *
 * MEASURED 2026-09-04, with `/-/npm/v1/security/advisories/bulk` answering HTTP 000 after 25s
 * while `registry.npmjs.org` answered 200 in 0.17s:
 *
 *   pnpm audit --json   ->  exit 0
 *                           metadata.vulnerabilities {info:0,low:0,moderate:0,high:0,critical:0}
 *                           advisories {}          (present, empty)
 *                           NO error envelope
 *
 * pnpm fails OPEN: it reports a clean tree when it could not ask. Byte for byte the same report a
 * genuinely clean repository produces, so nothing in the JSON can tell them apart — which is why
 * `isAuditEndpointUnavailable` cannot help here. That function keys on a non-zero exit and an error
 * envelope, and this failure has neither.
 *
 * The consequence is the worst shape a gate can take: `✓ audit  critical 0 · high 0 · …`, exit 0,
 * in `check` AND in the CI audit job, while nothing was verified. A hang would at least be loud.
 *
 * So this only says "ambiguous", never "broken". The caller resolves it by asking whether the
 * advisory service was actually reachable — the one question the report cannot answer about itself.
 */
export function isAuditResultAmbiguous(parsed) {
  if (!parsed?.advisories) return false; // npm-v2 shape: a different report, judged elsewhere
  if (Object.keys(parsed.advisories).length > 0) return false; // it listed something — it answered
  return sumSeverities(parsed?.metadata?.vulnerabilities) === 0;
}

/**
 * Per severity: how many findings are counted in `metadata.vulnerabilities` but absent from
 * `advisories`.
 *
 * Two causes produce this gap, and the report cannot tell them apart:
 *   1. advisories suppressed via `auditConfig.ignoreGhsas` — somebody assessed those.
 *   2. findings below pnpm's `--audit-level` — nobody has looked at those.
 * Which is why the number is called "unlisted" and never "ignored": it is an observation
 * ("counted, but not in the list"), not a claim about anyone's judgement. `assessedSeverities`
 * below is where that distinction is finally acted on.
 *
 * Cause 2 is NOT hypothetical and NOT opt-in. pnpm's default `--audit-level` is `low`, not
 * `info` (`AUDIT_LEVEL_NUMBER = { info: 0, low: 1, ... }`, filter `severity >= auditLevel`), so
 * `info` findings are dropped from `advisories` while still being counted — under a bare
 * `pnpm audit`, with no flag and no config. Any repo can hit this today.
 *
 * Returns all-zero when `advisories` is ABSENT rather than deriving from it. npm 7+ emits
 * `auditReportVersion: 2` with a `vulnerabilities` map and no `advisories` key at all, so
 * deriving the counts there would make every finding — including a real, unassessed critical —
 * look suppressed. That is the confusion this accounting exists to prevent, produced in reverse,
 * which is why the raw tally stays authoritative and this is reported beside it.
 *
 * Note `advisories: {}` (present, empty) is NOT the same as absent: pnpm emits it on every clean
 * run and on every run where the threshold filtered everything out. Only `undefined` means "this
 * package manager does not report advisories at all".
 */
export function countUnlistedBySeverity(parsed) {
  const empty = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  if (!parsed?.advisories) return empty;

  const counts = parsed?.metadata?.vulnerabilities ?? null;
  const listed = { ...empty };
  for (const advisory of Object.values(parsed.advisories)) {
    const severity = advisory?.severity;
    if (severity in listed) listed[severity] += 1;
  }

  // Clamped per severity: a package manager that counts vulnerable PATHS while listing one entry
  // per advisory would otherwise produce negatives. pnpm counts one per advisory (verified: 25
  // counted = 25 listed across 29 paths), and performs this same subtraction itself.
  return Object.fromEntries(SEVERITIES.map((s) => [s, Math.max(0, (counts?.[s] || 0) - listed[s])]));
}

/** Total across severities — the single number the summary line annotates. */
export function countUnlisted(parsed) {
  return sumSeverities(countUnlistedBySeverity(parsed));
}

/**
 * How many advisories this workspace suppresses via `auditConfig.ignoreGhsas`.
 *
 * This is the ONLY evidence that an unlisted finding was actually assessed by a human, and it is
 * what separates cause 1 from cause 2 above. It cannot be recovered from the audit report: a
 * suppressed advisory disappears from `advisories` completely, leaving nothing that says who
 * removed it or why.
 *
 * Deliberately narrow. It counts GHSA ids that appear as list entries under an `ignoreGhsas:`
 * key, and ignores commented-out lines — the sibling base repos document RETIRED suppressions in
 * comments right below that key, and counting those would claim an assessment that was withdrawn.
 * Anything it cannot parse returns 0, which renders the numbers loud: the safe direction.
 */
export function countSuppressions(root) {
  for (const file of ['pnpm-workspace.yaml', 'package.json']) {
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    // Located by LINE, not by character offset. `text.search(/(^|\n)…/)` returns the index of the
    // preceding newline, so slicing there and dropping one line landed back on the
    // `ignoreGhsas:` line itself — neither a comment nor an entry, so the block loop broke on its
    // first iteration and returned 0. That only showed up when the key is nested (under
    // `auditConfig:`), which is every real workspace; a top-level key happened to work because
    // the `^` branch matches at index 0.
    const lines = text.split('\n');
    const keyIdx = lines.findIndex((l) => /^\s*"?ignoreGhsas"?\s*:/.test(l));
    if (keyIdx === -1) continue;

    // Inline form: `ignoreGhsas: [GHSA-x, GHSA-y]` or the JSON equivalent.
    const inline = lines[keyIdx].match(/ignoreGhsas"?\s*:\s*\[([^\]]*)\]/);
    if (inline) return (inline[1].match(/GHSA-[0-9a-z]+(?:-[0-9a-z]+)*/gi) || []).length;

    // Block form: subsequent `- GHSA-...` lines, stopping at the first line that is neither a
    // list entry nor a comment.
    let found = 0;
    for (const line of lines.slice(keyIdx + 1)) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const entry = line.match(/^\s*-\s*"?(GHSA-[0-9a-z]+(?:-[0-9a-z]+)*)"?/i);
      if (!entry) break;
      found += 1;
    }
    return found;
  }
  return 0;
}

/**
 * Which severities were ASSESSED — every finding in the row suppressed by a human decision.
 *
 * Named for the state, not for what the renderer does with it: it used to be `assessedSeverities`,
 * which baked one presentation into the name and then outlived it. Three conditions, all necessary:
 *
 *   - The gate passed. On a FAILING run, "you already looked at this" is exactly the wrong thing
 *     to say, whatever the derivation suggests.
 *   - At least one suppression is configured. Without one, every unlisted finding is below the
 *     threshold and nobody has assessed anything — dimming there produces the very "teaches the
 *     reader to ignore the number" failure this accounting exists to prevent, pointed the other
 *     way. This is the condition that keeps the label honest.
 *   - The severity is ENTIRELY unlisted. A row with one listed and two unlisted findings still
 *     holds something live, so it stays loud.
 *
 * Per severity rather than all-or-nothing, because a single scalar cannot say WHICH row was
 * assessed: `critical 3 · moderate 1 (3 not listed)` reads as "the criticals are handled" whether
 * or not that is true.
 *
 * What the renderer does with this is YELLOW, not grey — changed 2026-09-04, matching
 * nest-server-starter ("never hide a suppression: a silently filtered advisory is
 * indistinguishable from one that never existed"). The evidence is concrete: a suppression in
 * nest-server sat obsolete for FIVE WEEKS because the backport landed one day after the check and
 * the greyed-out row never drew a second look.
 *
 * The honest counter-argument, recorded because it is not wrong: a permanently yellow `high 1` is
 * wallpaper too, just quieter, and the original complaint was desensitisation. What actually keeps
 * a suppression from rotting is `check-overrides.mjs`, which re-checks every suppressed GHSA
 * against the advisory API and reds when a fix has appeared. The colour is the reminder; that guard
 * is the safeguard. Yellow is right HERE because this repo runs it — a repo without it gets the
 * reminder and not the safeguard.
 */
export function assessedSeverities({ blocking = false, counts, suppressions = 0, unlisted }) {
  if (blocking || suppressions <= 0) return new Set();
  return new Set(SEVERITIES.filter((s) => (counts?.[s] || 0) > 0 && (unlisted?.[s] || 0) >= (counts?.[s] || 0)));
}

/**
 * The vulnerability summary line.
 *
 * Takes the whole audit record rather than positional arguments: every call site already has one,
 * and a defaulted `blocking` parameter fails OPEN — an omitted argument is `undefined`, `!undefined`
 * is true, and dimming would be permitted on exactly the failing run the rules above forbid it on.
 * (Dropping the default would not help; `undefined` is still falsy.)
 *
 * Note what `blocking` does and does not suppress: it gates the DIMMING only. The annotation is
 * appended either way, because "3 of these are not in the list" stays true and useful on a failing
 * run — it is the colour that would be making the false claim there, not the count.
 */
export function renderVulnLine(audit) {
  const counts = audit?.counts ?? {};
  const unlisted = audit?.unlisted ?? {};
  const assessed = assessedSeverities({
    blocking: audit?.blocking,
    counts,
    suppressions: audit?.suppressions,
    unlisted,
  });

  const line = SEVERITIES.map((s) => {
    const n = counts[s] || 0;
    const txt = `${s} ${n}`;
    if (n === 0) return C.dim(txt);
    if (assessed.has(s)) return C.yellow(txt);
    if (s === 'critical' || s === 'high') return C.red(txt);
    return C.yellow(txt);
  }).join(C.dim(' · '));

  // "not listed", never "assessed": half the findings this number covers are below `--audit-level`
  // and nobody has looked at them, so a label claiming assessment would be wrong for them — and it
  // would contradict the docblock above, which is the whole reason the value is called `unlisted`.
  // Same wording as lt-monorepo: this line is read by people, and one thing must not have two
  // names across the base repos.
  const total = sumSeverities(unlisted);
  if (total === 0) return line;

  // Name the severities when that is shorter than the reader guessing. A bare "(3 not listed)"
  // next to a red row invites the wrong row to be read as the handled one.
  const named = SEVERITIES.filter((s) => (unlisted[s] || 0) > 0)
    .map((s) => `${unlisted[s]} ${s}`)
    .join(', ');
  return `${line}${C.dim(` (${named} not listed)`)}`;
}
