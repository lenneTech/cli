---
name: nest-server-maintenance
description: Maintenance facts for the nest-server repo (pnpm) — override location, known blocked updates, install quirks
metadata:
  type: project
---

# nest-server repo (~/code/lenneTech/nest-server) — maintenance facts

- **Package manager: pnpm** (pnpm-lock.yaml, `packageManager` pinned in package.json). Overrides live in **`pnpm-workspace.yaml`** (`overrides:` key with inline `#` comments per entry), NOT in package.json — pnpm 11 ignores `package.json#pnpm`.
- **`mongodb` direct dep must track mongoose's pinned range** (mongoose 9.7.4 pins `mongodb: ~7.2`). Updating direct mongodb beyond that range creates TWO driver type instances → TS2322 `Collection<T>` incompatibility in `src/core/modules/better-auth/core-better-auth-challenge.service.ts`. Only bump mongodb when mongoose's own pin moves. (The starter tolerates 7.5.0 because it never mixes mongoose `Db` with direct `mongodb` types.)
- **@getbrevo/brevo >=4.x is a Fern-SDK full rewrite** — classic `TransactionalEmailsApi`/`SendSmtpEmail`/`TransactionalEmailsApiApiKeys` exports only exist in 3.x. Major bump requires rewriting `src/core/common/services/brevo.service.ts`. Stay on latest 3.x until a deliberate migration.
- **graphql 17 blocked** by peers: @nestjs/graphql needs `graphql ^16.11.0`, @nestjs/apollo `^16.10.0`.
- **graphql-upload >=16/17 is ESM-only** (only `.mjs` subpath exports, no `main`) — incompatible with this CJS-built framework.
- **typescript stays at the starter-validated version** (5.9.3 as of 2026-07). TS 7.x = tsgo; emitted d.ts ships to consumers — do not bump ahead of nest-server-starter.
- **pnpm add can strip the exec bit on `node_modules/@nestjs/cli/bin/nest.js`** ("Permission denied" exit 126 on `nest build`). The npm tarball ships the file WITHOUT +x; incremental `pnpm add` relinks sometimes lose the bit. Fix: `rm -rf node_modules && pnpm install` (clean install sets +x correctly). Note: `pnpm install`/`--force` after manually deleting a package dir says "Already up to date" and restores NOTHING — only a full node_modules wipe relinks.
- **oxfmt major bumps reformat Markdown under `src/`** (padded tables, comment collapse) — `format:check` is part of `pnpm run check`, so an oxfmt update forces `pnpm run format` (formatting-only src diffs; flag them in the report).
- **`@nestjs/websockets` removed 2026-07-18** — was an unused leftover from the better-auth draft (no src usage, only an OPTIONAL peer of @nestjs/core, @nestjs/graphql handles graphql-ws/ws itself, starter doesn't ship it). Consumers using `@WebSocketGateway` must declare it themselves.
- **Override-pruning method that works here:** remove ALL overrides, `pnpm install`, grep lockfile for resolved versions of each formerly-overridden package + `pnpm audit`; re-add only entries whose package falls back into a vulnerable range. On 2026-07-18 this left only `'ws@>=8.0.0 <8.21.0': '8.21.1'` (GHSA-96hv-2xvq-fx4p via @nestjs/graphql, resolves to 8.20.1 without it); ajv/picomatch/js-yaml became parent-pinned no-ops and uuid/@babel/core/websocket-driver vanished with @compodoc/compodoc 2.0.0.
- **compodoc 2.0.0** replaced live-server/babel chains (polka/sirv/chokidar, uuid 14.0.1, ts-morph ^28) — big transitive-tree shrink (~1260 → ~1100 resolved) and the reason several overrides died.
- **ts-morph 28 changes generated FRAMEWORK-API.md cosmetically** (optional props print `... | undefined`) — expected build-artifact churn, not an API change.
- **@nestjs/swagger >=11.4.3 ships an `exports` map** — deep imports `@nestjs/swagger/dist/...` fail at runtime (ERR_PACKAGE_PATH_NOT_EXPORTED / vite builtin:vite-resolve). `DECORATORS` is now part of the PUBLIC root export (`import { DECORATORS } from '@nestjs/swagger'`) — fixed in `tests/project.e2e-spec.ts` on 2026-07-18. Type-only deep imports (e.g. `unified-field.decorator.ts` → `schema-object-metadata.interface.js`) still compile fine (erased at transpile). Consumer-relevant: any consumer deep-importing swagger dist paths breaks on this transitive bump.
