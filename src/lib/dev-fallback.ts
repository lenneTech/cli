/**
 * The classic start, named as the fallback when `lt dev up` fails.
 *
 * `lt dev up` is the way to run a project on macOS, Linux and Windows (WSL2 included): stable
 * HTTPS URLs behind Caddy, no port collisions between parallel projects. When it cannot start,
 * the project still runs the classic way: `pnpm run start` at the project root runs the API on
 * :3000 and the App on :3001 (the starters' defaults, which the API's local config trusts). The
 * CLAUDE.md URL block, the final hint of `lt fullstack init` and every failing `lt dev up` name it
 * with the same words, so a person and an agent read one rule everywhere.
 */

/** API under the classic start (nest-server-starter's local port). */
export const CLASSIC_API_URL = 'http://localhost:3000';

/** App under the classic start (nuxt-base-starter's and ng-base-starter's dev port). */
export const CLASSIC_APP_URL = 'http://localhost:3001';

/**
 * The fallback as one terminal line, for a failing `lt dev up` and the final hint of `init`.
 * @param parts - Which components the project has
 * @param start - The start command in the project's package manager (`pnpm run start`)
 * @returns e.g. "Fallback: `pnpm run start` at the project root runs the API on http://localhost:3000 …"
 */
export function classicFallbackLine(parts: { api: boolean; app: boolean }, start = 'pnpm run start'): string {
  return `Fallback: \`${start}\` at the project root runs ${classicStartTargets(parts, false)}.`;
}

/**
 * What the classic start serves, e.g. "the API on `http://localhost:3000` and the App on `http://localhost:3001`".
 * @param parts - Which components the project has
 * @param code - Wrap the URLs in backticks (Markdown)
 * @returns The phrase, or an empty string for a project with neither
 */
export function classicStartTargets(parts: { api: boolean; app: boolean }, code = true): string {
  const url = (value: string): string => (code ? `\`${value}\`` : value);
  return [
    ...(parts.api ? [`the API on ${url(CLASSIC_API_URL)}`] : []),
    ...(parts.app ? [`the App on ${url(CLASSIC_APP_URL)}`] : []),
  ].join(' and ');
}
