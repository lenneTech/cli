---
name: mongosh-is-a-separate-install-from-mongod
description: CLI code paths that shell out to `mongosh` can silently no-op — mongosh is a separate install from mongod, and on Kai's dev machine mongod runs while mongosh is absent
metadata:
  type: project
---

Any lt CLI feature that shells out to `mongosh` must not assume it exists just because MongoDB is running. `mongod` (the server, e.g. via Homebrew) and `mongosh` (the shell) are **separate installs**.

Measured on Kai's machine (2026-07-13): `mongod` LISTENing on 127.0.0.1:27017, but `mongosh` **not on PATH**. An `execFileSync('mongosh', …)` therefore fails with ENOENT in ~80ms per call and returns "failure" — indistinguishable, in the current `catch { return false }` shape, from "Mongo unreachable".

**Why:** this matters because it silently defeats *cleanup* features. `dropDatabase()` in `src/lib/dev-ticket.ts` is best-effort via mongosh; on a machine like this it drops nothing while printing "could not drop db …". A feature whose whole purpose is reclaiming resources becomes a no-op plus noise, and the leak it was written to fix keeps growing unnoticed.

**How to apply:** when reviewing or writing mongosh-backed code paths, (1) verify the binary is present rather than assuming, (2) distinguish "mongosh missing" (config problem — tell the user once, actionably: `brew install mongosh`) from "DB unreachable" (transient), and (3) never let a resource-reclamation path report success-ish silence when it actually did nothing. Also check `mongodb` is *not* an npm dependency of this CLI (18 prod deps, driver absent) — so shelling out is the intended approach; bound it with a `timeout` rather than replacing it with the driver.

Related: [[gluegun-filesystem-sync]] — sync I/O is fine for local files in this CLI, but `execFileSync` for a **network** operation (Mongo) is a different risk class: it needs an explicit `timeout`.
