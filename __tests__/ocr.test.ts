import { filesystem, system } from 'gluegun';

const src = filesystem.path(__dirname, '..');

// `node bin/lt` is invoked once per spawn; the lt CLI loads the full
// command tree on every start (≈4 s on a warm machine), so each test
// pays that cost. Keep this suite minimal — three spawns is already
// >10 s. Reuse one spawn across assertions when adding cases.
const cli = async (cmd: string) => system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`);

describe('OCR Command', () => {
  describe('lt tools ocr --status', () => {
    test('reports status without crashing', async () => {
      const output = await cli('tools ocr --status');
      // Output should mention marker-pdf
      expect(output.toLowerCase()).toContain('marker');
      expect(output.toLowerCase()).toContain('python3');
      expect(output.toLowerCase()).toContain('venv');
    });
  });

  describe('lt tools ocr (no input)', () => {
    test('shows usage when called without input', async () => {
      // Use the canonical `tools ocr` path: gluegun does not promote
      // nested-command aliases (`ocr`, `pdf2md`) to the top level, so
      // `node bin/lt ocr` falls into the interactive menu and hangs
      // until Jest kills the worker.
      //
      // The command exits with code 1 to signal "missing input", so
      // `system.run` (execa) rejects. The diagnostic output is on the
      // error's `stdout`; capture it instead of treating the non-zero
      // exit as a test failure.
      let output = '';
      try {
        output = await cli('tools ocr');
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        output = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
      }
      expect(output.toLowerCase()).toMatch(/usage|missing input|--install/);
    });
  });

  describe('lt tools pdf2md alias', () => {
    test('alias `pdf2md` inside the tools namespace resolves to the same command', async () => {
      // Gluegun resolves aliases only within the same hierarchical
      // level (see CLAUDE.md "Alias Conflicts"), so the alias is
      // exercised as `tools pdf2md`, not `pdf2md` at the top level.
      const output = await cli('tools pdf2md --status');
      expect(output.toLowerCase()).toContain('marker');
    });
  });
});
