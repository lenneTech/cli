#!/usr/bin/env bash
# =============================================================================
# Smoke-test for `lt` CLI startup
# =============================================================================
# Starts `node bin/lt` in the background, waits for the interactive menu
# to appear, then kills the process. Used as the final step of
# `npm run check` to verify the compiled build produces a runnable CLI
# that loads all commands without errors (e.g. missing build artifacts,
# broken imports in the Gluegun command loader).
#
# Mirrors the nest-server-starter/scripts/check-server-start.sh pattern:
# background process + log polling + guaranteed cleanup on exit.
#
# Exit codes:
#   0  menu appeared within timeout
#   1  process died before menu appeared
#   2  timeout expired without menu appearing
# =============================================================================
set -e

LOG_FILE=$(mktemp)

# Marker string that proves the command loader initialized and gluegun
# reached the interactive prompt. The enquirer/gluegun banner always
# includes "Select command" before waiting for stdin.
READY_MARKER='Select command'
TIMEOUT_SECONDS=30

# Start CLI in background, no stdin attached so it can't block on
# interactive input. Redirect both stdout and stderr to the log file.
node ./bin/lt </dev/null >"$LOG_FILE" 2>&1 &
CLI_PID=$!

# Ensure cleanup on exit (normal exit, error, Ctrl+C).
# Each step is `|| true` so `set -e` does not mask the real script
# exit code if a cleanup step encounters an already-dead process.
trap 'kill "$CLI_PID" 2>/dev/null || true; wait "$CLI_PID" 2>/dev/null || true; rm -f "$LOG_FILE" || true' EXIT

# Poll the log file for the ready marker (max TIMEOUT_SECONDS seconds)
for _ in $(seq 1 "$TIMEOUT_SECONDS"); do
  if grep -q "$READY_MARKER" "$LOG_FILE" 2>/dev/null; then
    echo ""
    echo "CLI started successfully - menu appeared, check complete"
    exit 0
  fi

  # If the process died early, fail fast with diagnostics
  if ! kill -0 "$CLI_PID" 2>/dev/null; then
    echo ""
    echo "ERROR: CLI process exited before menu appeared"
    echo "--- Last output ---"
    tail -n 40 "$LOG_FILE"
    exit 1
  fi

  sleep 1
done

echo ""
echo "ERROR: timeout after ${TIMEOUT_SECONDS}s waiting for '$READY_MARKER'"
echo "--- Last output ---"
tail -n 40 "$LOG_FILE"
exit 2
