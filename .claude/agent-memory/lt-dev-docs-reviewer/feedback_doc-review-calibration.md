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
  third-party tool defaults (formatter quote style, parser behaviour) have been wrong in this repo
  before — run the tool and check.
- Published artifacts (commit messages, release notes, CHANGELOG entries) are **English**.
  See [[english-for-published-artifacts]].
