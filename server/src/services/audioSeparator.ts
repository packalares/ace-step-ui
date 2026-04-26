/**
 * Subprocess wrapper around the `audio-separator` CLI
 * (https://github.com/nomadkaraoke/python-audio-separator).
 *
 * Replaces the legacy browser-side Demucs that lived under
 * server/public/demucs-web/. We now run separation server-side
 * (CUDA on the pod) for both:
 *   - LoRA training-data preprocessing
 *   - Ad-hoc per-song stem extraction
 *
 * Models are cached under AUDIO_SEPARATOR_MODEL_DIR (defaults to
 * /app/.audio-separator-models) which is pre-warmed in the Dockerfile.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readdir, unlink } from 'fs/promises';
import path from 'path';

export interface SeparateOptions {
  inputPaths: string[];                 // absolute file paths
  outputDir: string;                    // absolute, will be created
  model: string;                        // e.g. "MelBandRoformer.ckpt"
  keepStems?: string[];                 // case-insensitive, e.g. ["vocals"]
  chain?: string[];                     // chained pipeline: [stage1Model, stage2Model, ...]
  extraArgs?: Record<string, unknown>;  // forwarded as --key=value
  onProgress?: (msg: string) => void;
  onStdout?: (line: string) => void;
}

export interface SeparateOutput {
  input: string;
  stems: { name: string; path: string }[];
}

export interface SeparateResult {
  outputs: SeparateOutput[];
  totalDurationMs: number;
}

const MODEL_DIR = process.env.AUDIO_SEPARATOR_MODEL_DIR ?? '/app/.audio-separator-models';
const CLI_BINARY = process.env.AUDIO_SEPARATOR_BINARY ?? 'audio-separator';

// audio-separator emits progress via tqdm. The percentage shows up in
// stderr as e.g.  "Separating: 42%|████" — match either stream.
const PROGRESS_RE = /(\d+)%\|/;

function buildArgs(input: string, model: string, outputDir: string, extra?: Record<string, unknown>): string[] {
  const args = [
    input,
    '--model_filename', model,
    '--output_dir', outputDir,
    '--output_format', 'WAV',
    '--model_file_dir', MODEL_DIR,
    '--use_autocast',
  ];

  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      if (val === undefined || val === null) continue;
      const flag = key.startsWith('--') ? key : `--${key}`;
      if (typeof val === 'boolean') {
        if (val) args.push(flag);
      } else {
        args.push(flag, String(val));
      }
    }
  }

  return args;
}

/**
 * Spawn audio-separator for a single (input, model) pair.
 * Resolves once the process exits; rejects on non-zero status.
 */
function runOnce(
  input: string,
  model: string,
  outputDir: string,
  extra: Record<string, unknown> | undefined,
  onStdout?: (line: string) => void,
  onProgress?: (msg: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = buildArgs(input, model, outputDir, extra);
    const proc = spawn(CLI_BINARY, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let lastPct = -1;
    const pumpLine = (line: string) => {
      if (!line) return;
      onStdout?.(line);
      const m = line.match(PROGRESS_RE);
      if (m && onProgress) {
        const pct = parseInt(m[1], 10);
        if (pct !== lastPct) {
          lastPct = pct;
          onProgress(`${pct}%`);
        }
      }
    };

    let stdoutBuf = '';
    let stderrBuf = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      let idx;
      // tqdm uses \r for in-place updates; split on either.
      while ((idx = stdoutBuf.search(/[\r\n]/)) >= 0) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        pumpLine(line);
      }
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8');
      let idx;
      while ((idx = stderrBuf.search(/[\r\n]/)) >= 0) {
        const line = stderrBuf.slice(0, idx);
        stderrBuf = stderrBuf.slice(idx + 1);
        pumpLine(line);
      }
    });

    proc.on('error', err => reject(err));
    proc.on('close', code => {
      if (stdoutBuf) pumpLine(stdoutBuf);
      if (stderrBuf) pumpLine(stderrBuf);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`audio-separator exited with code ${code} for ${path.basename(input)} using ${model}`));
      }
    });
  });
}

/**
 * Scan a directory for WAV stems produced for a given input basename.
 * audio-separator names files like:
 *   "<input_basename>_(<StemName>)_<modelName>.wav"
 */
async function findStemsFor(outputDir: string, inputBasename: string): Promise<{ name: string; path: string }[]> {
  if (!existsSync(outputDir)) return [];
  const entries = await readdir(outputDir);
  const escapedBase = inputBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stemRe = new RegExp(`^${escapedBase}_\\(([^)]+)\\)_.*\\.wav$`, 'i');

  const stems: { name: string; path: string }[] = [];
  for (const entry of entries) {
    const m = entry.match(stemRe);
    if (m) {
      stems.push({ name: m[1], path: path.join(outputDir, entry) });
    }
  }
  return stems;
}

function matchesKeepList(stemName: string, keep: string[]): boolean {
  const lower = stemName.toLowerCase();
  return keep.some(k => k.toLowerCase() === lower);
}

/**
 * Drum-component chains (e.g. SCNet → LarsNet to extract a kick stem)
 * are not yet supported by audio-separator's bundled model registry.
 *
 * TODO: when audio-separator adds LarsNet support (or we wire a separate
 * Python helper for it), replace this stub with a real two-stage pipeline:
 *   1. run stage 1 model on input → keep "drums" stem
 *   2. run stage 2 model on that drums stem → keep requested component
 *      ("kick", "snare", etc.).
 *
 * For now we run only stage 1 and surface a warning in the job log.
 */
function isChainSupported(_chain: string[]): boolean {
  // We don't have LarsNet/drum-component models bundled yet.
  return false;
}

export async function separateStems(opts: SeparateOptions): Promise<SeparateResult> {
  const { inputPaths, outputDir, model, keepStems, chain, extraArgs, onProgress, onStdout } = opts;

  await mkdir(outputDir, { recursive: true });
  await mkdir(MODEL_DIR, { recursive: true });

  const startedAt = Date.now();
  const outputs: SeparateOutput[] = [];

  const useChain = chain && chain.length > 1;
  if (useChain && !isChainSupported(chain!)) {
    const msg = `[audio-separator] chain pipeline (${chain!.join(' → ')}) not yet supported — falling back to stage-1 model only`;
    console.warn(msg);
    onStdout?.(msg);
    onProgress?.(msg);
  }

  for (let i = 0; i < inputPaths.length; i++) {
    const input = inputPaths[i];
    if (!existsSync(input)) {
      throw new Error(`Input not found: ${input}`);
    }
    const inputBasename = path.basename(input, path.extname(input));

    onProgress?.(`(${i + 1}/${inputPaths.length}) ${path.basename(input)}`);
    onStdout?.(`[audio-separator] separating ${input} with ${model}`);

    await runOnce(input, model, outputDir, extraArgs, onStdout, onProgress);

    const stems = await findStemsFor(outputDir, inputBasename);

    // Filter / cleanup based on keepStems.
    let kept = stems;
    if (keepStems && keepStems.length > 0) {
      kept = stems.filter(s => matchesKeepList(s.name, keepStems));
      const dropped = stems.filter(s => !matchesKeepList(s.name, keepStems));
      for (const d of dropped) {
        try { await unlink(d.path); } catch { /* ignore */ }
      }
    }

    outputs.push({ input, stems: kept });
  }

  return {
    outputs,
    totalDurationMs: Date.now() - startedAt,
  };
}
