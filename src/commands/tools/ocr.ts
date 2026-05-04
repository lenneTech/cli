import { existsSync, statSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { resolve } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { getMarkerStatus, installMarker, type OcrDevice, resolveDevice, runMarker } from '../../lib/marker';

/**
 * OCR command: convert PDFs (or a directory of PDFs) to clean Markdown
 * using marker-pdf with Apple Silicon MPS acceleration when available.
 *
 * Marker is kept in `~/.lt/marker/.venv/`; it is auto-installed on the
 * first run (~3 GB model download). Subsequent runs reuse the cache.
 *
 * Examples:
 *   lt tools ocr ./report.pdf
 *   lt tools ocr ./pdfs --output-dir ./md --workers 4
 *   lt tools ocr --install
 *   lt tools ocr --status
 */
const NewCommand: GluegunCommand = {
  alias: ['ocr', 'pdf2md'],
  description: 'OCR PDFs to Markdown via marker-pdf (MPS-accelerated on Apple Silicon)',
  hidden: false,
  name: 'ocr',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      parameters,
      print: { error, info, spin, warning },
    } = toolbox;

    const showStatus = !!parameters.options.status;
    const installOnly = !!parameters.options.install;

    // Status mode
    if (showStatus) {
      const status = await getMarkerStatus();
      const device = resolveDevice('auto');
      info('marker-pdf status:');
      info(`  installed: ${status.installed ? 'yes' : 'no'}`);
      info(`  python3:   ${status.pythonAvailable ? 'yes' : 'no'}`);
      info(`  uv:        ${status.uvAvailable ? 'yes' : 'no'}`);
      info(`  venv:      ${status.venvPath}`);
      info(`  device:    ${device} (auto-detected)`);
      if (!toolbox.parameters.options.fromGluegunMenu) process.exit(0);
      return 'ocr';
    }

    // Install-only mode
    if (installOnly) {
      const installSpinner = spin('Installing marker-pdf …');
      try {
        await installMarker({
          onProgress: (msg) => {
            installSpinner.text = msg;
          },
        });
        installSpinner.succeed('marker-pdf installed');
      } catch (err) {
        installSpinner.fail('Installation failed');
        error(String((err as Error).message));
        if (!toolbox.parameters.options.fromGluegunMenu) process.exit(1);
        return 'ocr';
      }
      if (!toolbox.parameters.options.fromGluegunMenu) process.exit(0);
      return 'ocr';
    }

    // Normal run: need an input path
    const inputArg = parameters.first;
    if (!inputArg) {
      error('Missing input path. Usage:');
      info('  lt tools ocr <file.pdf|directory>           Convert PDFs to Markdown');
      info('  lt tools ocr --install                       Install marker-pdf locally');
      info('  lt tools ocr --status                        Show installation status');
      info('');
      info('Options:');
      info('  --output-dir <dir>     Output directory (default: <input>-MD/)');
      info('  --workers <n>          Parallel workers for batch mode (default: 3)');
      info('  --device <auto|mps|cuda|cpu>   Override TORCH_DEVICE (default: auto)');
      info('  --skip-existing        Skip already-converted files (batch mode)');
      info('  --keep-images          Extract embedded images (default: off)');
      info('  --format <markdown|json|html|chunks>   Output format (default: markdown)');
      if (!toolbox.parameters.options.fromGluegunMenu) process.exit(1);
      return 'ocr';
    }

    const inputPath = resolve(process.cwd(), inputArg);
    if (!existsSync(inputPath)) {
      error(`Input not found: ${inputPath}`);
      if (!toolbox.parameters.options.fromGluegunMenu) process.exit(1);
      return 'ocr';
    }

    // Auto-install if needed
    let status = await getMarkerStatus();
    if (!status.installed) {
      warning('marker-pdf not yet installed — running first-time setup …');
      const installSpinner = spin('Installing marker-pdf (one-time, ~3 GB model download) …');
      try {
        await installMarker({
          onProgress: (msg) => {
            installSpinner.text = msg;
          },
        });
        installSpinner.succeed('marker-pdf installed');
        status = await getMarkerStatus();
      } catch (err) {
        installSpinner.fail('Installation failed');
        error(String((err as Error).message));
        if (!toolbox.parameters.options.fromGluegunMenu) process.exit(1);
        return 'ocr';
      }
    }

    // Resolve options
    const isDir = statSync(inputPath).isDirectory();
    const defaultOutput = isDir ? `${inputPath}-MD` : `${inputPath}.md-out`;
    const outputDir = resolve(
      process.cwd(),
      String(parameters.options['output-dir'] ?? parameters.options.outputDir ?? defaultOutput),
    );
    const workers = Number(parameters.options.workers ?? 3);
    const skipExisting = parameters.options['skip-existing'] !== false; // default: true
    const keepImages = !!parameters.options['keep-images'];
    const format = String(parameters.options.format ?? 'markdown') as 'chunks' | 'html' | 'json' | 'markdown';
    const device = (parameters.options.device ?? 'auto') as OcrDevice;

    info(`OCR ${isDir ? 'batch' : 'single'} → ${outputDir}`);
    info(`  device: ${resolveDevice(device)}`);
    if (isDir) info(`  workers: ${workers}, skip-existing: ${skipExisting}`);
    info('');

    const runSpinner = spin('Converting (may take a while on first run while models load)…');
    let lastLine = '';
    const result = await runMarker(inputPath, {
      device,
      disableImages: !keepImages,
      onLine: (line) => {
        // Forward marker output to spinner text (last line) so the user sees progress
        if (line.trim()) {
          lastLine = line.replace(/\s+/g, ' ').trim().slice(-160);
          runSpinner.text = lastLine;
        }
      },
      outputDir,
      outputFormat: format,
      skipExisting,
      workers,
    });

    if (result.exitCode === 0) {
      runSpinner.succeed(`Done — output in ${outputDir}`);
    } else {
      runSpinner.fail(`marker exited with code ${result.exitCode}: ${lastLine}`);
      if (!toolbox.parameters.options.fromGluegunMenu) process.exit(result.exitCode);
    }

    if (!toolbox.parameters.options.fromGluegunMenu) process.exit(0);
    return 'ocr';
  },
};

export default NewCommand;
