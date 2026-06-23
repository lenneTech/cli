/**
 * Helpers for (un)hooking the vendor-freshness step in a project's `check`
 * scripts during vendor-mode conversion. Extracted so the logic is unit-tested
 * (server.ts + frontend-helper.ts call these instead of inline closures).
 */

const WRAPPER_HINT = 'check.mjs';
const FRESHNESS_STEP = 'pnpm run check:vendor-freshness';
const INSTALL_PREFIX = 'pnpm install && ';

/**
 * Prepend the `check:vendor-freshness` step to the relevant check scripts.
 *
 * - Skips a script that already includes the step (idempotent) or that IS the
 *   `node scripts/check.mjs` wrapper (the wrapper only orchestrates the real
 *   chain — vendor-freshness belongs in that chain).
 * - Targets `check:raw` instead of `check` when the project runs the wrapper,
 *   so freshness becomes a step the wrapper executes.
 * - Preserves a leading `pnpm install && ` so install stays first.
 *
 * Assumes the caller has already defined `scripts['check:vendor-freshness']`.
 * Mutates `scripts` in place.
 */
export function hookCheckFreshness(scripts: Record<string, string>): void {
  const hook = (name: string): void => {
    const existing = scripts[name];
    if (!existing || existing.includes('check:vendor-freshness') || existing.includes(WRAPPER_HINT)) {
      return;
    }
    scripts[name] = existing.startsWith(INSTALL_PREFIX)
      ? `${INSTALL_PREFIX}${FRESHNESS_STEP} && ${existing.slice(INSTALL_PREFIX.length)}`
      : `${FRESHNESS_STEP} && ${existing}`;
  };
  // Prefer the raw chain when the project runs the check.mjs wrapper.
  hook(scripts['check:raw'] ? 'check:raw' : 'check');
  hook('check:fix');
  hook('check:naf');
}

/**
 * Remove the vendor-freshness step (and its script) from a project's check
 * scripts — the inverse of {@link hookCheckFreshness}, used when converting a
 * project back to npm mode. Mutates `scripts` in place.
 */
export function unhookCheckFreshness(scripts: Record<string, string>): void {
  delete scripts['check:vendor-freshness'];
  for (const name of ['check', 'check:raw', 'check:fix', 'check:naf']) {
    if (typeof scripts[name] === 'string') {
      scripts[name] = scripts[name].replace(/pnpm run check:vendor-freshness && /g, '');
    }
  }
}
