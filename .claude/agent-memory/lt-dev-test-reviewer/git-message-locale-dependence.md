---
name: git-message-locale-dependence
description: Tests matching git's English stderr pass on Kai's Apple git (no gettext) but fail under a German gettext git; how to prove it in Docker
metadata:
  type: project
---

Any test that regex-matches git's human text (`/not a git repository/`, `fatal:` …) is locale-dependent. A gettext-enabled git (Debian/Ubuntu, Homebrew) prints e.g. `Schwerwiegend: Kein Git-Repository (oder irgendeines der Elternverzeichnisse): .git` under `LANGUAGE=de`. Kai's machine runs Apple git (`/usr/bin/git`, Xcode), which is NOT localized, so a green local `npm run check` proves nothing about this. CI runs in English locales, so it does not catch it either; a German-locale teammate on Linux/Homebrew git does.

**Why:** found 2026-10-11 reviewing the `gitMainRepoRoot` stderr-capture test: the whole `dev-ticket.test.ts` was green under German git before that diff, the new test was the only failure.

**How to apply:** prefer locale-free assertions (`toThrow()` + `expect(stderrSpy).not.toHaveBeenCalled()`, exit status, porcelain output) or pin `LC_ALL=C` for the spawned git. To prove a suspicion: `docker run node:22-bookworm` (image is local), tar-copy the repo (exclude `.git`) to `/work`, `npm pack @unrs/resolver-binding-linux-arm64-gnu@<unrs-resolver version>` and untar it into `node_modules/@unrs/…` (Jest 30's resolver otherwise reports every setup file as "not found"), then run jest with `LANG=C.UTF-8 LANGUAGE=de`. Repo mounted `:ro`, so nothing on the host changes. See also [[proving-regression-tests-safely]].
