/**
 * The `check:unified-field-types` script in vendor and npm mode.
 *
 * nest-server 12.8.7 ships `bin/check-unified-field-types.js` (package bin
 * `nest-check-unified-field-types`): it finds every `@UnifiedField` without `type` / `isAny` /
 * `enum` whose type the SWC dev start and the tsc build read differently, and `--fix` writes the
 * tsc type in. nest-server-starter runs it as `check:unified-field-types` in `check:raw`, and with
 * `-- --fix` in `check:fix` and `check:naf`. Only that script names the package bin; the chains
 * call it with `<pm> run`. A vendored project has no package bin, so the conversion copies the file
 * next to `bin/migrate.js` and points the script at it.
 */

/** The script nest-server-starter defines. */
export const UNIFIED_FIELD_TYPES_SCRIPT = 'check:unified-field-types';

/** The file the vendored project carries, next to `bin/migrate.js`. */
export const UNIFIED_FIELD_TYPES_BIN = 'bin/check-unified-field-types.js';

/** The script value in npm mode (the package bin). */
export const UNIFIED_FIELD_TYPES_NPM_COMMAND = 'nest-check-unified-field-types';

/** The script value in vendor mode. */
export const UNIFIED_FIELD_TYPES_VENDOR_COMMAND = `node ./${UNIFIED_FIELD_TYPES_BIN}`;

/** One `&&` link that runs the script, with or without `-- --fix`. */
const CALL = new RegExp(`^(?:pnpm|npm|yarn|bun)(?: run)? ${UNIFIED_FIELD_TYPES_SCRIPT}(?: -- --fix)?$`);

/** The npm form again, when the script still has exactly the vendored value. */
export function unifiedFieldTypesScriptsForNpm(scripts: Record<string, string>): void {
  if (scripts[UNIFIED_FIELD_TYPES_SCRIPT] === UNIFIED_FIELD_TYPES_VENDOR_COMMAND) {
    scripts[UNIFIED_FIELD_TYPES_SCRIPT] = UNIFIED_FIELD_TYPES_NPM_COMMAND;
  }
}

/**
 * Points the script at the vendored file when the core ships it. With a core that does not (before
 * nest-server 12.8.7), the script and every `&&` link that calls it are removed, since they would
 * run a binary nothing provides. A starter without the script, and a value the project changed,
 * stay as they are.
 * @param scripts - `package.json#scripts`, changed in place
 * @param binShipped - Whether the vendored core brought `bin/check-unified-field-types.js`
 */
export function unifiedFieldTypesScriptsForVendor(scripts: Record<string, string>, binShipped: boolean): void {
  if (scripts[UNIFIED_FIELD_TYPES_SCRIPT] !== UNIFIED_FIELD_TYPES_NPM_COMMAND) return;
  if (binShipped) {
    scripts[UNIFIED_FIELD_TYPES_SCRIPT] = UNIFIED_FIELD_TYPES_VENDOR_COMMAND;
    return;
  }
  delete scripts[UNIFIED_FIELD_TYPES_SCRIPT];
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue;
    const links = command.split(' && ');
    const kept = links.filter((link) => !CALL.test(link.trim()));
    if (kept.length !== links.length) scripts[name] = kept.join(' && ');
  }
}
