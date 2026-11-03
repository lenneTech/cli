// Remove the given paths recursively, the job `npx rimraf` did in the package scripts.
// Node's own rmSync does it on every platform, so the repo needs no dependency for it.
import { rmSync } from 'node:fs';

for (const path of process.argv.slice(2)) {
  rmSync(path, { force: true, recursive: true });
}
