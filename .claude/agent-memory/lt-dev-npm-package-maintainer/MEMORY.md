---
description: NPM Package Maintainer memory for lenne.tech CLI project
---

# NPM Package Maintainer Memory - lenne.tech CLI

- [cli maintenance](project_cli.md) — npm-based; baseline 673 tests/51 suites; blocked: eslint 10, TS 7, js-yaml 5, @types/jsdom 28.0.3, prettier 3.9.x; only override left: semver@* 7.8.5
- [nest-server maintenance](project_nest-server-maintenance.md) — overrides in pnpm-workspace.yaml; mongodb must track mongoose pin; brevo 4+/graphql 17/graphql-upload 16+ blocked; nest bin exec-bit quirk
- [nuxt-extensions maintenance](project_nuxt-extensions.md) — TS 7 blocked by @nuxt/module-builder peer ^5.8.3; pnpm-pin sha512-hex method; @nuxt/kit range intentional
- [lt-monorepo maintenance](project_lt-monorepo.md) — template repo; pnpm 11 default 24h release-age gate auto-writes minimumReleaseAgeExclude; c-a-t-v 13 deferred
- [nuxt-base-starter maintenance](project_nuxt-base-starter.md) — unhead-v2 pins stay while nuxt on unhead v2; @nuxt/ui override target tracks app version; pin-contract test needs BOTH manifests
