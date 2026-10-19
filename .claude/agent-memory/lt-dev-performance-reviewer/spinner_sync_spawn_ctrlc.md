---
name: spinner-sync-spawn-ctrlc
description: A sync spawn (spawnSync/spawnCmdSync/execSync) under a gluegun spinner makes the command deaf to Ctrl+C until the child exits — measured in a pty; how to test it
metadata:
  type: project
---

gluegun's `print.spin` is ora 4.0.2 with `discardStdin: true`: on macOS/Linux it puts the TTY in raw mode (ISIG off) and turns the `\x03` byte into SIGINT from a stdin `data` handler. That handler needs the Node event loop. A synchronous child spawn while the spinner runs blocks the loop, so Ctrl+C is neither a signal (raw mode) nor read (loop blocked): it is deferred until the child exits. The spinner also freezes. On Windows ora skips the discarder, so this does not apply there.

Measured 2026-10-19 (reviewing the `lt directus typegen` switch from async `system.run` to `spawnCmdSync`), Ctrl+C sent at 1.5 s, child `sleep 8`:

| Shape under spinner | Process gone after |
|---|---|
| `await system.run(...)` (async exec) | ~1.76 s |
| `spawnCmdSync(...)` | ~8.16 s (child's full runtime) |

**Why:** async → sync conversions look neutral in a diff and pass every test (Jest has no TTY), but they turn a network-bound child (e.g. `directus-sdk-typegen`: three parallel `fetch` with no timeout, undici `headersTimeout` 300 s) into an uninterruptible command.

**How to apply:** when a diff replaces an async spawn with a sync one, check whether a spinner is active around it. To prove it, run a tiny script under `script -q /dev/null node x.js` with stdin `( sleep 1.5; printf '\003'; sleep 12 ) |` and time the node process externally via `pgrep` (`process.on('exit')` does not fire on signal death, so in-process timing misses the async case). The async counterpart is `platform.ts#spawnCmd`. Related: [[cli-perf-calibration]], [[gluegun-filesystem-sync]].
