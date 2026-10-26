---
name: tsmorph-two-programs-convert-esm
description: ts-morph getEmitOutput builds a SECOND program+checker next to getPreEmitDiagnostics' one; convert-esm heap sizes on real vendored lt APIs (turbo OOMs at the 4.5 GB limit)
metadata:
  type: project
---

ts-morph 28 keeps two separate TypeScript programs per Project: `project.getPreEmitDiagnostics()` runs on ts-morph's own `ts.createProgram` (LanguageService#program), while `sourceFile.getEmitOutput()` goes through `ts.LanguageService.getEmitOutput`, which builds the language service's OWN program and type-checks again. Calling both on one Project doubles the type-checked memory. Emitting through the already checked program avoids it: `project.getProgram().compilerObject.emit(sf.compilerNode, (name, text) => …)`. On the nest-server-starter it gave identical results (498 requests, 2 findings) and cut the emit loop from 1469 ms to 163 ms.

**Measured 2026-10-26, `lt server convert-esm` (`esm-convert.ts`), Node 24, V8 heap limit 4496 MB on a 34 GB Mac:**

| Project (vendored, files incl. core) | Total | Peak |
|---|---|---|
| nest-server-starter 11.43.3, npm, 71 files | 18 s | 1.8 GB RSS |
| lt-crm/projects/api, 1034 files | 79 s lib / 103 s real command | heapUsed 4011 MB (89 %) |
| turbo/projects/api, 1342 files | OOM at 84 s in `collectEmittedNamedImports` | live 4075 MB |
| turbo with emit through the checked program | 70 s | live 3.49 GB (peak after Mark-Compact, `--trace-gc`) |
| turbo + `sources.removeSourceFile` for every file before step 7 | 67 s | live 3.11 GB |

Live heap (forced GC): 1.49 GB after the bare rewrite Project (step 4), 3.6 GB after the type checks. Setting the `sources` variable to `undefined` before step 7 changed nothing, so something else retains it; removing its source files from the Project does release them (shipped, 2026-10-26). The type-checked Project alone retains 2.18 GB on turbo. `convertCommonJsSyntax` alone takes 9-20 s, because it wraps every Identifier node.

**Why:** the real lt projects on Kai's machine are at or past the default heap limit, so memory, not time, is the failure mode of whole-project ts-morph analysis in this CLI.

**How to apply:** for any new code that type-checks a whole consumer project with ts-morph, measure on a copy of turbo/lt-crm (`rsync --exclude node_modules`, symlink `node_modules`, run the compiled `build/lib` function). Never use the live project. Delete the copies afterwards, because they contain customer code and `.env` files. To drive a gluegun command from a script, set `process.argv` BEFORE requiring `build/cli`, otherwise the interactive menu opens and waits on stdin. To wait on a PID without sleep, use `caffeinate -w <pid>`. Related: [[cli-perf-calibration]], [[cli-repo-static-only]].
