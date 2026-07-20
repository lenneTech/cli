# Security Reviewer Memory

- [CLI-repo review scope](project_cli-repo-review-scope.md) — this repo is the CLI itself; audit CLI code + GENERATED config, not NestJS/Nuxt runtime patterns
- [CLI generated-file injection sinks](reference_cli-generated-file-injection.md) — where user/config values reach generated source/config (angular env, .turboops.json, .dockerignore); validate before write
- [Gluegun flag parsing fails open](reference_gluegun-flag-parsing-fail-open.md) — yargs-parser makes `--flag=true` a STRING; strict `=== true` on a destruction-PREVENTING flag destroys data
- [spawnDetached sh -c exec is SAFE](reference_spawndetached-sh-exec-safe.md) — `sh -c 'ulimit…; exec "$0" "$@"'` binds cmd/args as positional params, not into the script; injection-safe, do not re-flag
