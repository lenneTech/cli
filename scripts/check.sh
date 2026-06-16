#!/usr/bin/env bash
# =============================================================================
# `npm run check` orchestrator with a vulnerability gate
# =============================================================================
# Runs the full local quality pipeline:
#
#   1. Vulnerability gate  — `npm audit` (abort on ANY finding)
#   2. npm install
#   3. npm run format
#   4. npm run build       (lint + test + compile + copy-templates)
#   5. npm run check:start (CLI startup smoke-test)
#
# The gate is the part the plain chained script never had: if `npm audit`
# reports any vulnerability (>= low), `check` STOPS instead of silently
# building on top of vulnerable dependencies. Fix them first
# (`npm run check:fix` / `npm audit fix`) or bypass the gate explicitly:
#
#   npm run check --force        # npm sets npm_config_force=true
#   npm run check -- --force     # forwarded to this script as an argument
#
# Exit codes:
#   0  pipeline passed (or gate bypassed with --force and the rest passed)
#   1  vulnerabilities found (gate) or a later step failed
# =============================================================================
set -euo pipefail

# --- Resolve flags: --force (bypass gate) / --audit-only (gate, then stop) -----
force=0
audit_only=0
[ "${npm_config_force:-}" = "true" ] && force=1
for arg in "$@"; do
  case "$arg" in
    --force | -f) force=1 ;;
    --audit-only) audit_only=1 ;;
  esac
done

# --- 1. Vulnerability gate ----------------------------------------------------
if [ "$force" -eq 1 ]; then
  echo "⚠  --force: skipping the npm audit vulnerability gate."
else
  echo "▶  Vulnerability gate: npm audit (--audit-level=low) …"
  if npm audit --audit-level=low; then
    echo "✓  No known vulnerabilities."
  else
    echo ""
    echo "✖  npm audit found vulnerabilities (see the report above)."
    echo "   Fix them first:   npm run check:fix     (or: npm audit fix)"
    echo "   Bypass once:      npm run check --force"
    exit 1
  fi
fi

# `npm run check:audit` only wants the gate verdict, not the full build.
if [ "$audit_only" -eq 1 ]; then
  exit 0
fi

# --- 2.-5. The actual pipeline ------------------------------------------------
npm install
npm run format
npm run build
npm run check:start
