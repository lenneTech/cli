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
  pnpm-internals claims are checkable offline: the corepack bundle lives at
  `~/.cache/node/corepack/v1/pnpm/<ver>/dist/pnpm.mjs` (grep it with `/usr/bin/grep`; the shell's
  grep is ugrep and chokes on long-line regexes). Verified 2026-10-03: `store prune` deletes
  every store file with `nlink === 1`, so clone/reflink imports really do empty the store.
  Cross-repo claims *are* verifiable and were all correct here: a starter version floor
  (`git log --oneline` around the release commit), a TurboOps "since vX" claim (`git log
  vA..vB`), and a quoted upstream error string / API call.
- Published artifacts (commit messages, release notes, CHANGELOG entries) are **English**.
  (Kai's rule: everything published is written in English.)

- **A comment that claims TEST COVERAGE is a factual claim too — execute it, don't read it.** A
  new test in `__tests__/heal-check-wrapper.test.ts` carried "Derived from the file rather than
  hard-coded, so the next sibling is covered without touching this test", but its regex matched
  `from '...'` (single quotes) while `src/templates/check/check.mjs` uses double quotes — the
  `matchAll` loop ran **zero** iterations and asserted nothing. Reproduce such loops with a
  throwaway `node -e` against the real fixture before crediting the comment.
- **Bridge-block / formatter claims can be reproduced end to end, offline.** Copy the consumer's
  `playwright.config.ts` + formatter config into the scratchpad, call `patchPlaywrightConfig` via
  `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node10","ignoreDeprecations":"6.0"}' npx ts-node -T`
  (plain `ts-node` dies on TS 6's moduleResolution deprecation), run the consumer's own pinned
  formatter binary from its `node_modules/.pnpm/<fmt>@<ver>/…/bin`, then re-patch and `cmp`.
  Running the HEAD copy of `dev-patches.ts` the same way proves the "before" half of a bugfix
  claim. oxfmt's defaults are in its shipped `configuration_schema.json` (printWidth also falls
  back to `.editorconfig` `max_line_length`).
- **More offline checks that worked (2026-10-08):** a claim about the rendered Caddy block →
  write it to the scratchpad and `caddy adapt --config <file> --adapter caddyfile` (Homebrew caddy
  is on PATH), plus `sysctl kern.ipc.somaxconn`; a "since nest-server X.Y.Z" claim →
  `git tag --contains <first commit>` in `~/code/lenneTech/nest-server`; a list of a package's
  runtime exports → grep `^exports\.` in its `lib/*.js` under some repo's `node_modules`.
  Stale summary lines in `docs/VENDOR-MODE-WORKFLOW.md` / `docs/LT-ECOSYSTEM-GUIDE.md` that
  describe what a conversion does automatically are not acted on by any lt-dev agent (checked via
  grep in the plugin), so imprecision there stays below a High bar.
- **For `src/templates/**` assets, "does this file exist?" has TWO answers.** A freshly
  `lt fullstack init`-ed project gets the whole `lt-monorepo` clone (e.g.
  `scripts/nuxt-builddir-isolation.test.mjs`, `test:scripts`); a project migrated via
  `lt fullstack update` → `healCheckWrapper` gets only what the CLI bundles in
  `src/templates/check/`. A template comment naming a sibling file must be checked against BOTH
  populations, and the CLI's template dir is usually the smaller one.
- **"stderr no longer reaches the terminal" claims are checkable in 10 lines (2026-10-11).** Node's
  `execFileSync` appends the child's stderr to the thrown `error.message` in every mode, but ALSO
  writes it to `process.stderr` only when `options.stdio` is unset (Node 24). A `node -e` script that
  swaps `process.stderr.write` and runs `git rev-parse` in a non-repo tmp dir, once with the old
  options and once with the new, proves both halves; a test asserting only on the message proves
  nothing.
- **Plugin-permission claims (`lt claude plugins`) are checkable offline (2026-10-18).** A new
  field in a plugin's `permissions.json` must also exist in each plugin's
  `permissions.schema.json` in `~/code/lenneTech/claude-code/plugins/*/` (and
  `claude-code-internal`), which sets `additionalProperties: false`; compare the docs example with
  the real upstream values there. "`CLAUDE_PLUGIN_ROOT` is not set for Bash tool commands" is
  verified by `echo ${CLAUDE_PLUGIN_ROOT-unset}` in your own Bash tool. For a "`CLAUDE_CONFIG_DIR`
  counts everywhere" claim, grep `src` for `homedir`, `'.claude'` and `.claude/` together.
- **"Last gap closed" / completeness claims about shell injection need a grep wider than
  `system.run` (2026-10-19).** `src/commands/mongodb/{collection-export,s3-restore}.ts` use
  `promisify(require('child_process').exec)` directly, so a `run(`-only grep misses them. Grep
  `execAsync\(|execSync\(|[^.]exec\(|shell:\s*true` too. Live proof is safe and offline:
  `node bin/lt mongodb collection-export --noConfirm --mongoUri 'mongodb://127.0.0.1:1$(touch PWNED)' </dev/null`
  from a scratchpad dir creates `PWNED` (runs the compiled `build/`; check the build copy still
  matches the source first). `npx <bin>` claims: libnpmexec runs a local or GLOBAL bin of that
  name before fetching the same-named package (npm's `libnpmexec/lib/index.js`, `globalBin`).
- **Claims about what a RUNNING Caddy has loaded are checkable without touching the user's daemon
  (2026-10-20).** `GET http://127.0.0.1:2019/config/` is read-only; for a scratch daemon run
  `CADDY_ADMIN=127.0.0.1:29019 XDG_DATA_HOME=<scratch> XDG_CONFIG_HOME=<scratch> caddy run --config <file> --adapter caddyfile`
  in the background, curl `:29019/config/`, then `pkill -f` it. Verified that way: live `/config/` and
  `caddy adapt` differ in bytes but match after key sort; a comments-only Caddyfile is `{}` on both
  sides. Doc check-list numbering ("checks 2, 3 and 6 stay green") must be checked against the
  DOCS' numbering, not the code comments' — `doctor.ts` reuses "4." twice, so the two disagree.
- **Recipes that worked for the nest-server-12 prep review (2026-10-25):**
  - "Exactly one version was ever generated" claims (heal exact-match constants): loop
    `git log --format=%h -- <file>` in `bash -c`, extract the generator block per commit with
    awk and `md5`; then `eval` the array literal from HEAD and from the constant and compare.
  - Unreleased cross-repo work (nest-server 12, starter) sits UNCOMMITTED in the sibling repo's
    working tree: check claims against the working tree, and `git show HEAD:<path>` for the
    "older core" half.
  - js-yaml 4 vs 5 differentials: a 4.x copy lives in another repo's
    `node_modules/.pnpm/js-yaml@4.*`; scratchpad scripts must `require` ts-node by absolute path.
    Measured: whitespace-only input is `undefined` in 4.x but `null` from `loadYaml` (the
    comment says null) — harmless, every caller treats both as empty.
  - TS-option claims: CLI's `node_modules/.bin/tsc` is 6.0.3 (needs `--ignoreConfig` in the
    scratchpad), `nest-server-starter/node_modules/typescript` is 5.9.3.
- **Recipes from the ESM / pinned-vendor review (2026-10-26), result: 0 High findings:**
  - "Falls back to the default branch when the tag is missing": check that the error regex sees
    git's stderr through `execFile` by running `git clone --depth 1 --branch 99.99.99 --
    file:///…/nest-server dst` from a `node -e` and testing `isMissingCloneRef` against
    `err.message` (Node puts stderr into the message). It matched.
  - "Migration guide §N" claims: `grep '^## '` in `nest-server/migration-guides/11.43.x-to-12.0.x.md`.
  - "Version X lacks helper Y": `git grep -l Y <tag> -- src` in the nest-server checkout.
  - Probe a new command's flag allow-list without a project: run `node bin/lt <cmd> --dry-run …`
    in an empty scratch dir. It should fail with "no project", not with "unknown option".
