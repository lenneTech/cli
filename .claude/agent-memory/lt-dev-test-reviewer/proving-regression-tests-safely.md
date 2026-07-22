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
npx tsc --ignoreConfig --target ES2020 --module commonjs --moduleResolution node \
  --esModuleInterop --skipLibCheck --rootDir "$SP" --outDir "$SP/out" "$SP"/harness.ts "$SP"/{old,new}/<file>.ts
node "$SP/out/harness.js"
```

`--ignoreConfig` is required (tsc refuses to load the repo `tsconfig.json` when files are
passed on the CLI). Older revisions of the same file (`git show <sha>^:path`) can be added
as a third implementation to replay a historically-shipped upgrade against the new logic —
that is how the masked-upgrade class of bug gets found.

The scratchpad is shared with the other parallel reviewers — only delete directories you
created yourself.
