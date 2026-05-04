#!/usr/bin/env bash
#
# Offline smoke-test for the incremental fullstack flow:
#
#   - lt fullstack add-api  with a local --api-copy fixture
#   - lt fullstack add-app  with a local --frontend-copy fixture
#   - lt fullstack init     auto-delegating to add-* in an existing workspace
#
# Goal: verify the workspace gate, layout detection, and lt.config.json
# wiring without ever hitting the network. We feed a tiny hand-rolled
# fixture (just enough package.json + minimal src/) via the --copy
# flag so the framework setup primitives accept it.
#
# This is opt-in for CI: it costs <30s and exercises codepaths that
# the in-process Jest tests do not (real subprocess spawning + real
# filesystem mutations). Run as part of the release dance via
#
#   pnpm run test:incremental-fullstack
#
# (script is excluded from the default `npm test` to keep the inner
# loop fast).
#
# Exit code 0 = all scenarios passed.
# Exit code 1 = any scenario failed.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI_BIN="${CLI_ROOT}/bin/lt"
WORK_DIR="/tmp/lt-incremental-it"

RED="\033[0;31m"
GREEN="\033[0;32m"
BOLD="\033[1m"
RESET="\033[0m"

pass() { echo -e "  ${GREEN}[PASS]${RESET} $*"; }
fail() { echo -e "  ${RED}[FAIL]${RESET} $*"; FAILED=1; }
heading() { echo -e "\n${BOLD}=== $* ===${RESET}"; }

FAILED=0

# ── Setup ────────────────────────────────────────────────────────────

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

# Minimal nest-server-starter fixture. The CLI's setup primitives only
# need package.json with a recognisable shape + a src/ tree. We
# include enough to make convertCloneToVendored bail early in npm mode
# without crashing.
mkdir -p api-fixture/src
cat > api-fixture/package.json <<'EOF'
{
  "name": "fixture-api",
  "version": "0.0.0",
  "scripts": { "test": "echo ok" },
  "dependencies": { "@lenne.tech/nest-server": "*" }
}
EOF
cat > api-fixture/src/main.ts <<'EOF'
// fixture entry — enough for lt to pattern-match a NestJS server
EOF
cat > api-fixture/src/config.env.ts <<'EOF'
export const config = { secretOrPrivateKey: 'placeholder', mongoose: { uri: 'mongodb://localhost/fixture' } };
EOF
mkdir -p api-fixture/src/meta
cat > api-fixture/src/meta.json <<'EOF'
{ "name": "fixture-api", "description": "fixture", "version": "0.0.0" }
EOF

# Minimal nuxt-base-template fixture.
mkdir -p app-fixture
cat > app-fixture/package.json <<'EOF'
{
  "name": "fixture-app",
  "version": "0.0.0",
  "dependencies": { "nuxt": "*", "@lenne.tech/nuxt-extensions": "*" }
}
EOF
cat > app-fixture/.env.example <<'EOF'
NUXT_PUBLIC_STORAGE_PREFIX=fixture-local
EOF

# ── Scenario 1: add-api dry-run + real copy into workspace ────────────

heading "Scenario 1: lt fullstack add-api with --api-copy fixture"

mkdir -p ws-add-api/projects/app
cat > ws-add-api/projects/app/package.json <<'EOF'
{ "name": "ws-app", "version": "0.0.0" }
EOF
cat > ws-add-api/pnpm-workspace.yaml <<'EOF'
packages:
  - 'projects/*'
EOF

cd ws-add-api
# Dry-run first — must not touch disk.
"${CLI_BIN}" fullstack add-api \
  --api-mode Rest \
  --framework-mode npm \
  --api-copy "${WORK_DIR}/api-fixture" \
  --dry-run \
  --noConfirm \
  > /tmp/dry.log 2>&1 || true
if [ -d "projects/api" ]; then
  fail "dry-run created projects/api/ (it must not)"
else
  pass "dry-run did not create projects/api/"
fi

# Real run with --skip-install (no pnpm/network).
"${CLI_BIN}" fullstack add-api \
  --api-mode Rest \
  --framework-mode npm \
  --api-copy "${WORK_DIR}/api-fixture" \
  --skip-install \
  --noConfirm \
  > /tmp/real.log 2>&1 || {
    cat /tmp/real.log
    fail "add-api with --api-copy failed"
  }

if [ -f "projects/api/package.json" ]; then
  pass "projects/api/package.json exists"
else
  fail "projects/api/package.json missing"
fi
if [ -f "projects/api/lt.config.json" ]; then
  pass "projects/api/lt.config.json was written"
  if grep -q '"apiMode": "Rest"' projects/api/lt.config.json; then
    pass "lt.config.json contains apiMode: Rest"
  else
    fail "lt.config.json missing apiMode: Rest"
  fi
else
  fail "projects/api/lt.config.json missing"
fi
cd "${WORK_DIR}"

# ── Scenario 2: add-app dry-run + real copy into workspace ────────────

heading "Scenario 2: lt fullstack add-app with --frontend-copy fixture"

mkdir -p ws-add-app/projects/api
cat > ws-add-app/projects/api/package.json <<'EOF'
{ "name": "ws-api", "version": "0.0.0" }
EOF
cat > ws-add-app/pnpm-workspace.yaml <<'EOF'
packages:
  - 'projects/*'
EOF

cd ws-add-app
"${CLI_BIN}" fullstack add-app \
  --frontend nuxt \
  --frontend-framework-mode npm \
  --frontend-copy "${WORK_DIR}/app-fixture" \
  --skip-install \
  --noConfirm \
  > /tmp/real-app.log 2>&1 || {
    cat /tmp/real-app.log
    fail "add-app with --frontend-copy failed"
  }

if [ -f "projects/app/package.json" ]; then
  pass "projects/app/package.json exists"
else
  fail "projects/app/package.json missing"
fi
if [ -f "projects/app/.env" ]; then
  if grep -q "NUXT_PUBLIC_STORAGE_PREFIX=" projects/app/.env; then
    pass "projects/app/.env was patched with NUXT_PUBLIC_STORAGE_PREFIX"
  else
    fail "projects/app/.env did not get NUXT_PUBLIC_STORAGE_PREFIX patched"
  fi
else
  fail "projects/app/.env missing (.env.example was not copied → patched)"
fi
cd "${WORK_DIR}"

# ── Scenario 3: init auto-delegates to add-api ───────────────────────

heading "Scenario 3: lt fullstack init in workspace with only app → delegates to add-api"

mkdir -p ws-init-delegate/projects/app
cat > ws-init-delegate/projects/app/package.json <<'EOF'
{ "name": "ws-app", "version": "0.0.0" }
EOF
cat > ws-init-delegate/pnpm-workspace.yaml <<'EOF'
packages:
  - 'projects/*'
EOF

cd ws-init-delegate
output=$("${CLI_BIN}" fullstack init \
  --api-mode Rest \
  --framework-mode npm \
  --dry-run \
  --noConfirm 2>&1 || true)

if echo "$output" | grep -q 'delegating to .lt fullstack add-api'; then
  pass "init delegated to add-api"
else
  fail "init did not delegate to add-api"
fi
if echo "$output" | grep -q 'Dry-run plan'; then
  pass "delegated dry-run plan was printed"
else
  fail "delegated dry-run plan missing"
fi
cd "${WORK_DIR}"

# ── Scenario 4: standalone refusal under --noConfirm ─────────────────

heading "Scenario 4: standalone server create refuses inside workspace"

mkdir -p ws-refuse/projects/app
cat > ws-refuse/projects/app/package.json <<'EOF'
{ "name": "ws-app", "version": "0.0.0" }
EOF
cat > ws-refuse/pnpm-workspace.yaml <<'EOF'
packages:
  - 'projects/*'
EOF

cd ws-refuse
set +e
"${CLI_BIN}" server create \
  --name standalone \
  --api-mode Rest \
  --framework-mode npm \
  --noConfirm \
  > /tmp/refuse.log 2>&1
ec=$?
set -e

if [ "$ec" -eq 1 ]; then
  pass "standalone server create exited with 1 inside workspace"
else
  fail "expected exit code 1, got ${ec}"
fi
if grep -q 'Refusing' /tmp/refuse.log; then
  pass "refusal message present"
else
  fail "refusal message missing"
fi
if [ -d "standalone" ]; then
  fail "stray standalone/ directory was created (should have been refused)"
else
  pass "no stray standalone/ directory created"
fi
cd "${WORK_DIR}"

# ── Wrap-up ──────────────────────────────────────────────────────────

heading "Summary"
if [ "${FAILED}" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All incremental-fullstack scenarios passed.${RESET}"
  rm -rf "${WORK_DIR}"
  exit 0
else
  echo -e "${RED}${BOLD}Some scenarios failed — see logs above.${RESET}"
  echo "Workspace artefacts left at ${WORK_DIR}"
  exit 1
fi
