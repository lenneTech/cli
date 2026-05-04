/**
 * marker-pdf integration for the lt CLI.
 *
 * Marker (https://github.com/datalab-to/marker) is a PyTorch-based
 * PDF → Markdown converter with first-class layout, table and equation
 * support. On Apple Silicon it leverages Metal Performance Shaders
 * (MPS) for GPU-accelerated inference.
 *
 * The CLI keeps marker in an isolated Python virtualenv under
 * `~/.lt/marker/.venv/` so that:
 *   - we do not pollute the user's global Python environment
 *   - the ~3 GB of model weights are downloaded only once
 *   - subsequent runs start instantly (cached models)
 */
import { exec, spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

const MARKER_HOME = join(homedir(), '.lt', 'marker');
const VENV_DIR = join(MARKER_HOME, '.venv');
const VENV_BIN = join(VENV_DIR, 'bin');
const VENV_PYTHON = join(VENV_BIN, 'python3');
const VENV_MARKER_SINGLE = join(VENV_BIN, 'marker_single');
const VENV_MARKER_BATCH = join(VENV_BIN, 'marker');

export interface MarkerRunOptions {
  device?: OcrDevice;
  disableImages?: boolean;
  outputDir: string;
  outputFormat?: 'chunks' | 'html' | 'json' | 'markdown';
  skipExisting?: boolean;
  workers?: number;
}

export interface MarkerStatus {
  installed: boolean;
  pythonAvailable: boolean;
  uvAvailable: boolean;
  venvPath: string;
}

export type OcrDevice = 'auto' | 'cpu' | 'cuda' | 'mps';

/**
 * Detect tool availability.
 */
export async function getMarkerStatus(): Promise<MarkerStatus> {
  const status: MarkerStatus = {
    installed: false,
    pythonAvailable: false,
    uvAvailable: false,
    venvPath: VENV_DIR,
  };

  try {
    await execAsync('python3 --version');
    status.pythonAvailable = true;
  } catch {
    // python3 missing
  }

  try {
    await execAsync('uv --version');
    status.uvAvailable = true;
  } catch {
    // uv missing — we'll fall back to python -m venv + pip
  }

  status.installed = existsSync(VENV_MARKER_SINGLE) && existsSync(VENV_MARKER_BATCH);
  return status;
}

/**
 * Install marker-pdf into ~/.lt/marker/.venv.
 *
 * Preferred path: `uv venv --python 3.12` + `uv pip install marker-pdf psutil`.
 * Fallback: `python3 -m venv` + `pip install`.
 */
export async function installMarker(opts: { onProgress?: (msg: string) => void } = {}): Promise<void> {
  const log = opts.onProgress ?? (() => {});
  const status = await getMarkerStatus();

  if (status.installed) {
    log('marker already installed');
    return;
  }

  if (!status.pythonAvailable) {
    throw new Error(
      'python3 is required but not found in PATH. Install Python 3.10+ (e.g. via Homebrew: `brew install python@3.12`)',
    );
  }

  await mkdir(MARKER_HOME, { recursive: true });

  const useUv = status.uvAvailable;

  // 1. Create virtualenv
  if (useUv) {
    log('Creating venv with uv (Python 3.12)…');
    await execAsync(`uv venv --python 3.12 "${VENV_DIR}"`, { cwd: MARKER_HOME });
  } else {
    log('Creating venv with python3 (uv not found, falling back)…');
    await execAsync(`python3 -m venv "${VENV_DIR}"`, { cwd: MARKER_HOME });
  }

  // 2. Install marker-pdf + psutil
  // psutil is needed by the marker batch CLI; it is a soft dep on some
  // marker-pdf releases, so we install it explicitly.
  // We use shell quoting to handle macOS "Library" / spaces in paths.
  const cmd = useUv
    ? `uv pip install --python "${VENV_PYTHON}" marker-pdf psutil`
    : `"${VENV_BIN}/pip" install marker-pdf psutil`;

  log('Installing marker-pdf + dependencies (~3 GB models will download on first run)…');
  // Increase maxBuffer because pip output is large
  await execAsync(cmd, { cwd: MARKER_HOME, maxBuffer: 100 * 1024 * 1024 });

  if (!existsSync(VENV_MARKER_SINGLE)) {
    throw new Error(`marker installation finished but ${VENV_MARKER_SINGLE} not found`);
  }
  log('marker installed successfully');
}

/**
 * Decide the correct TORCH_DEVICE for this machine.
 */
export function resolveDevice(requested: OcrDevice = 'auto'): OcrDevice {
  if (requested !== 'auto') return requested;
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mps';
  // We don't probe nvidia-smi here — let PyTorch decide CUDA at runtime
  return 'cpu';
}

/**
 * Run marker on a single PDF or a directory of PDFs.
 */
export async function runMarker(
  inputPath: string,
  opts: MarkerRunOptions & { onLine?: (line: string) => void },
): Promise<{ exitCode: number }> {
  const status = await getMarkerStatus();
  if (!status.installed) {
    throw new Error('marker is not installed. Run `lt tools ocr --install` first.');
  }

  const isDir = existsSync(inputPath) && (await import('fs')).statSync(inputPath).isDirectory();
  const bin = isDir ? VENV_MARKER_BATCH : VENV_MARKER_SINGLE;

  const args: string[] = [];
  if (isDir) {
    args.push(inputPath);
  } else {
    args.push(inputPath);
  }
  args.push('--output_dir', opts.outputDir);
  args.push('--output_format', opts.outputFormat ?? 'markdown');
  if (opts.disableImages) args.push('--disable_image_extraction');
  if (isDir) {
    if (opts.skipExisting) args.push('--skip_existing');
    if (opts.workers && opts.workers > 0) args.push('--workers', String(opts.workers));
  }

  const device = resolveDevice(opts.device);

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      env: {
        ...process.env,
        TORCH_DEVICE: device,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onLine = opts.onLine ?? ((l: string) => process.stdout.write(`${l}\n`));
    const handleStream = (stream: NodeJS.ReadableStream) => {
      let buf = '';
      stream.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const line of lines) if (line) onLine(line);
      });
    };
    handleStream(proc.stdout!);
    handleStream(proc.stderr!);

    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 0 });
    });
    proc.on('error', reject);
  });
}
