---
name: cli-repo-static-only
description: The lt CLI repo itself has no HTTP server / frontend bundle / DB — perf reviews here are static-only; k6 + Lighthouse are N/A
metadata:
  type: project
---

When the review target is the **lt CLI itself** (`~/code/lenneTech/cli`, the Gluegun/TypeScript CLI — not a generated api/app project), a performance review is **pure static analysis of the diff**. There is no long-running HTTP server, no frontend bundle, no database.

**Why:** it is a command-line tool that spawns short-lived processes and reads/writes local JSON state + log files. The relevant perf surfaces are process-spawn cost, sync file I/O (`readFileSync`/`writeFileSync` in [[gluegun-filesystem-sync]]), and CPU/allocation in hot loops (e.g. `lt dev status --all` over N registered projects).

**How to apply:** skip the k6 load-test phase, the bundle/rendering/DB phases, and any "detect running backend / start a server" step — mark them N/A, do not attempt to boot anything. Focus grading on Memory & Resources and Async & Concurrency. Realistic N for the `--all` project loop is single-to-low-double digits, so O(N) Date/allocation work is immeasurable; the dominant per-project cost is the pre-existing `loadSession` disk read, and multi-port liveness is already batched into a single `lsof` via `listenSnapshot`.
