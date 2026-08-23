---
name: doc-review-calibration
description: How to calibrate documentation reviews in the lt CLI repo — size-match the demand, name what is already sufficient, and map the generic dimensions onto this repo's real artifacts
metadata:
  type: feedback
---

Documentation reviews in the `cli` repo must be **calibrated to the size of the change** and must
explicitly name the places where documentation is *already sufficient* — not only the gaps.

**Why:** the standard doc-reviewer dimensions (module README, interface JSDoc, migration guide,
`.env.example`) are written for NestJS/Nuxt product repos. This repo is a Gluegun CLI: there are no
`src/server/modules/*/README.md`, no `ServerOptions` interface, no `.env.example`, and no
`migration-guides/`. Scoring those as missing produces a false-alarm report. A review that demands a
migration guide for a 12-line internal bugfix gets ignored, and then the one finding that mattered
gets ignored with it.

**How to apply:**
- Map the five dimensions onto this repo's real doc artifacts before scoring:
  1. Inline comments + JSDoc in the changed source file (incl. the file-header contract)
  2. `CLAUDE.md` → **Gotchas & Learnings** — the repo's Self-Maintenance rule makes this a
     *mandatory* artifact for any non-obvious bug/pattern discovery. Format:
     `### Title <!-- Added: YYYY-MM-DD -->`
  3. `CLAUDE.md` → the relevant **key touchpoints** table row (the "module docs" analogue)
  4. `docs/commands.md` / `docs/lt.config.md` / README (user-facing; only when flags, config keys
     or observable behaviour change)
  5. `CHANGELOG.md` / commit type (`standard-version`, conventional commits)
- Mark inapplicable dimensions **N/A** and exclude them from the overall percentage.
- When recommending a `CLAUDE.md` Gotcha, **draft the exact paste-ready text** (title +
  `<!-- Added: … -->` + body) instead of just asking for one.
- **Verify factual claims in comments**, don't just check that a comment exists. Claims about
  third-party tool behaviour have been wrong in this repo **twice** now, so treat every such
  sentence as unverified until checked against the installed package:
  - a comment asserted a formatter's default quote style, which was actually project-specific;
  - a `dev-test-session.ts` comment asserted "unlike `NUXT_BUILD_DIR`, Nitro reads no such
    variable on its own" — neither `NUXT_BUILD_DIR` nor `NITRO_OUTPUT_DIR` is framework-native
    (grep `@nuxt/schema` + `nitropack` in a starter's `node_modules/.pnpm`; both are read only by
    the project's own `nuxt.config.ts`).
  The recurring shape is an **asymmetric contrast** ("unlike X, Y needs …") that silently
  promotes X to a framework feature. Check BOTH halves, and check whether the same file already
  states the opposite elsewhere — self-contradiction within one file is the cheapest tell.
  Cross-repo claims *are* verifiable and were all correct here: a starter version floor
  (`git log --oneline` around the release commit), a TurboOps "since vX" claim (`git log
  vA..vB`), and a quoted upstream error string / API call.
- Published artifacts (commit messages, release notes, CHANGELOG entries) are **English**.
  See [[english-for-published-artifacts]].

- **A comment that claims TEST COVERAGE is a factual claim too — execute it, don't read it.** A
  new test in `__tests__/heal-check-wrapper.test.ts` carried "Derived from the file rather than
  hard-coded, so the next sibling is covered without touching this test", but its regex matched
  `from '...'` (single quotes) while `src/templates/check/check.mjs` uses double quotes — the
  `matchAll` loop ran **zero** iterations and asserted nothing. Reproduce such loops with a
  throwaway `node -e` against the real fixture before crediting the comment.
- **For `src/templates/**` assets, "does this file exist?" has TWO answers.** A freshly
  `lt fullstack init`-ed project gets the whole `lt-monorepo` clone (e.g.
  `scripts/nuxt-builddir-isolation.test.mjs`, `test:scripts`); a project migrated via
  `lt fullstack update` → `healCheckWrapper` gets only what the CLI bundles in
  `src/templates/check/`. A template comment naming a sibling file must be checked against BOTH
  populations, and the CLI's template dir is usually the smaller one.
