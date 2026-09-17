/**
 * The environment git subprocesses run with so they never block on a prompt.
 *
 * Two variables, one rule each:
 *
 * `GIT_TERMINAL_PROMPT=0` stops git asking for credentials on a dead terminal.
 * A prompt in a detached or CI child is not a question anyone can answer — it is
 * a hang that looks like a slow network.
 *
 * `GIT_SSH_COMMAND` only supplies a DEFAULT, and the distinction is expensive.
 * `BatchMode=yes` makes ssh fail rather than PROMPT — but an agent that stalls is
 * not a prompt. On a 1Password-backed machine the agent is reachable and every
 * signature needs interactive approval; unattended it waits, then reports
 * `communication with agent failed`. Measured at 61s per fetch, which made
 * `lt git update --dry-run` take 62s and `lt git create --dry-run` 123s (two
 * fetches). `ConnectTimeout` does not bound that — it covers the TCP connect,
 * not the agent.
 *
 * Waiting for a human to approve a key is legitimate for an interactive command,
 * so the default itself is unchanged. What was wrong was assigning it
 * UNCONDITIONALLY: that overrode anyone who had configured ssh deliberately,
 * including a test harness trying to make the behaviour deterministic. A
 * caller's own value therefore always wins (`IdentityAgent=none` in their env
 * drops the same fetch to ~1s with a clean `Permission denied (publickey)`); the
 * fallback only keeps an unconfigured machine from hanging.
 *
 * This exists as an environment object rather than a shell prefix because
 * `VAR=value git …` is not assignment syntax to cmd.exe — it reads the whole
 * thing as a command name and fails with "'GIT_TERMINAL_PROMPT' is not
 * recognized". Handing the child an env works on every platform, and it is the
 * only spelling that does. Keep it here rather than inline at each call site:
 * this is the single place the default is defined, which is what lets a test
 * assert that nobody assigns GIT_SSH_COMMAND unconditionally anywhere else.
 *
 * One caveat if you ever read a variable back off the returned object: spreading
 * `process.env` produces a PLAIN object, which on Windows loses the
 * case-insensitive lookup the real `process.env` proxy provides. The value is
 * intact under its original spelling (`Path`, not `PATH`), and handing the whole
 * object to `spawn` works — but `result.PATH` is undefined there.
 */
export function nonInteractiveGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_SSH_COMMAND: base.GIT_SSH_COMMAND || 'ssh -o ConnectTimeout=5 -o BatchMode=yes',
    GIT_TERMINAL_PROMPT: '0',
  };
}
