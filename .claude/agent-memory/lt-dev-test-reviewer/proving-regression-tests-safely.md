---
name: proving-regression-tests-safely
description: How to empirically prove a new test is a real regression test in the lt CLI repo without corrupting the concurrent `npm run check` run
metadata:
  type: project
---

To prove a new test actually FAILS against the pre-change implementation, A/B the two
implementations in an **isolated scratchpad harness** — never `git stash`, never edit
`src/` temporarily.

**Why:** `/lt-dev:review` runs `npm run check` (→ `lint && test && build`) **concurrently**
with the reviewer agents. Mutating a file under `src/` mid-run makes the concurrent build
compile a half-reverted tree and produce phantom failures. And `package.json#jest` sets
`rootDir: "__tests__"` + `testMatch: ["<rootDir>/*.test.ts"]`, so dropping a scratch
`*.test.ts` into `__tests__/` gets it collected by that concurrent run too.

**How to apply:** extract both versions into the scratchpad, stub the type-only imports,
compile standalone, run a plain node comparison:

```bash
git show HEAD:src/lib/<file>.ts | perl -pe "s|^import \{ T \} from './x';|type T = any;|" > "$SP/old/<file>.ts"
perl -pe "s|^import \{ T \} from './x';|type T = any;|" src/lib/<file>.ts > "$SP/new/<file>.ts"
npx --prefix <repo> tsc --ignoreConfig --ignoreDeprecations 6.0 --target ES2020 --module commonjs \
  --moduleResolution node --esModuleInterop --skipLibCheck \
  --typeRoots <repo>/node_modules/@types --types node \
  --rootDir "$SP" --outDir "$SP/out" "$SP"/harness.ts "$SP"/{old,new}/<file>.ts
node "$SP/out/harness.js"
```

`--ignoreConfig` is required (tsc refuses to load the repo `tsconfig.json` when files are
passed on the CLI). Since TS 6, `--moduleResolution node` raises TS5107 unless
`--ignoreDeprecations 6.0` is passed (it still emits, but exit is non-zero). A private
helper under test (e.g. `normaliseBridgeBlock`) can be exported in BOTH scratch copies with
a one-line `perl -0pi` so the harness can probe it directly. A table of mutation cases
(want=tolerate/detect) run through old and new side by side answers "does the new test
fail on HEAD" and "did leniency open a gap" in one pass. Older revisions of the same file (`git show <sha>^:path`) can be added
as a third implementation to replay a historically-shipped upgrade against the new logic —
that is how the masked-upgrade class of bug gets found.

The scratchpad is shared with the other parallel reviewers — only delete directories you
created yourself.

**Probing the CURRENT implementation only** (no A/B needed — e.g. "does this reachable
branch fire at all?") is cheaper: put a `probe.ts` in the scratchpad that imports the
source by ABSOLUTE path and requires `js-yaml` / `gluegun` by absolute
`node_modules/...` path (bare specifiers do not resolve from the scratchpad), then
`npx ts-node --compiler-options '{"module":"commonjs","target":"ES2020","esModuleInterop":true,"skipLibCheck":true,"strict":false}' "$SP/probe.ts"`.
Nothing under `src/` or `__tests__/` is touched, so a concurrent `npm run check` is safe.

**Whole-command A/B (2026-10-19).** `bin/lt` runs `src/` through ts-node whenever `src/`
exists next to it, so a full `lt …` command can be A/B'd without building: export HEAD with
`git archive HEAD | tar -x -C "$SP/head"`, symlink the repo's `node_modules` into it, build a
throwaway bare-origin + clone fixture in the scratchpad, then run
`node <repo>/bin/lt …` vs `node $SP/head/bin/lt …` there with `env -u GIT_DIR HOME=$SP/home`.
Copying a new test file (plus any new `src/lib` it imports) into the export answers "does it
fail on HEAD" for spawn-based tests too.

**Always probe CLI validators with the argv shape gluegun produces.** yargs-parser turns a
digit-only POSITIONAL into a number too (`lt git create 2314` → `parameters.first === 2314`),
not only flag values. A new string guard that calls `.trim()` on raw input (`safeRef`, 2026-10-19)
crashed `lt git create 2314` / `lt git rebase --base 77`, which worked on HEAD. The unit tests
only fed string literals, so nothing caught it.

**Commands that shell out to package managers (2026-10-19, `lt npm reinit`).** Put stub
scripts named `ncu`/`rimraf`/`pnpm`/`npm`/`yarn`/`npx` in `$SP/stubs` that append
`name | cwd=$(pwd)` plus one `arg=[…]` line per argv element to `$PROBE_LOG`, then run
`node <root>/bin/lt … --noConfirm --fromGluegunMenu` with
`PATH=$SP/stubs:<node dir>:/usr/bin:/bin HOME=$SP/home`. Stubs FIRST, so nothing global is
installed even where the command calls `pm.globalInstall`. The log shows the cwd and the
argv each tool actually received, which a builder-string unit test cannot. Realistic trigger
for any `cd ${dir} &&` shell prefix: a Finder duplicate (`app copy`). macOS `/bin/sh`
(bash 3.2) runs `cd /x/app copy` as `cd /x/app`, ignoring the extra word, so the rest of
the chain runs in the SIBLING project. HEAD's reinit deleted the sibling's lockfile and
node_modules this way and exited 0.
