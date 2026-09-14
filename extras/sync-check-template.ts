/**
 * Sync src/templates/check/ from a pinned lt-monorepo state.
 *
 *   npm run sync:check-template -- --ref <tag|sha> [--from <git url | local path>]
 *
 * Without --ref the current pin is re-applied. See src/lib/check-template-sync.ts.
 */
import { join } from 'path';

import { CHECK_TEMPLATE_PIN_FILE, readCheckTemplatePin, syncCheckTemplate } from '../src/lib/check-template-sync';

const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const templateDir = join(__dirname, '..', 'src', 'templates', 'check');
const ref = argValue('--ref') ?? readCheckTemplatePin(join(templateDir, CHECK_TEMPLATE_PIN_FILE))?.commit;

if (!ref) {
  console.error('Usage: npm run sync:check-template -- --ref <tag|sha> [--from <git url | local path>]');
  process.exit(1);
}

try {
  const pin = syncCheckTemplate({ from: argValue('--from'), ref, templateDir });
  console.log(`Synced check template ${pin.version} from ${pin.repository}@${pin.commit}`);
  for (const [name, hash] of Object.entries(pin.files)) {
    console.log(`  ${name}  ${hash.slice(0, 12)}`);
  }
} catch (error) {
  console.error(`sync:check-template failed: ${(error as Error).message}`);
  process.exit(1);
}
