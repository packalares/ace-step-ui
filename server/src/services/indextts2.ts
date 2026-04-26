import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

export interface CloneOptions {
  refAudioPath: string;
  text: string;
  outputPath: string;
  emoAudioPath?: string;
  emoAlpha?: number;
  emoVector?: number[]; // 8-dim
  emoText?: string;
  fp16?: boolean;
  intervalSilence?: number;
  seed?: number;
  device?: string;
  modelDir?: string;
  onProgress?: (line: string) => void;
}

export interface CloneResult {
  outputPath: string;
  durationSeconds: number;
  totalElapsedMs: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default script path — repo-root /python/indextts2_infer.py.
// In the deployed pod the repo is mounted at /app, so /app/python/... matches.
const DEFAULT_SCRIPT = path.resolve(__dirname, '../../../python/indextts2_infer.py');

function resolveBinary(): string {
  return process.env.INDEXTTS2_PYTHON || 'python';
}

function resolveScript(): string {
  return process.env.INDEXTTS2_SCRIPT || DEFAULT_SCRIPT;
}

/**
 * Run the IndexTTS2 voice-clone subprocess and resolve when the WAV is on disk.
 * Throws with stderr included on a non-zero exit.
 */
export async function cloneVoiceTTS(opts: CloneOptions): Promise<CloneResult> {
  const args: string[] = [
    resolveScript(),
    '--ref-audio', opts.refAudioPath,
    '--text', opts.text,
    '--output', opts.outputPath,
  ];

  if (opts.emoAudioPath) args.push('--emo-audio', opts.emoAudioPath);
  if (typeof opts.emoAlpha === 'number') args.push('--emo-alpha', String(opts.emoAlpha));
  if (opts.emoText) args.push('--emo-text', opts.emoText);
  if (opts.emoVector && opts.emoVector.length > 0) {
    args.push('--emo-vector', opts.emoVector.join(','));
  }
  if (opts.fp16 !== false) args.push('--fp16'); // default true
  if (typeof opts.intervalSilence === 'number') args.push('--interval-silence', String(opts.intervalSilence));
  if (typeof opts.seed === 'number') args.push('--seed', String(opts.seed));
  if (opts.device) args.push('--device', opts.device);
  if (opts.modelDir) args.push('--model-dir', opts.modelDir);

  const startedAt = Date.now();

  return new Promise<CloneResult>((resolve, reject) => {
    const proc = spawn(resolveBinary(), args, {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let lastProgress: Record<string, string> = {};

    const flushLines = (chunk: string, sink: (line: string) => void) => {
      const combined = stdoutBuf + chunk;
      const lines = combined.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line) sink(line);
      }
    };

    proc.stdout.on('data', (data: Buffer) => {
      flushLines(data.toString('utf8'), (line) => {
        if (line.startsWith('[INDEXTTS]')) {
          // Parse `key=value key=value` for our own bookkeeping.
          const kv: Record<string, string> = {};
          for (const tok of line.replace('[INDEXTTS]', '').trim().split(/\s+/)) {
            const idx = tok.indexOf('=');
            if (idx > 0) kv[tok.slice(0, idx)] = tok.slice(idx + 1);
          }
          lastProgress = { ...lastProgress, ...kv };
        }
        opts.onProgress?.(line);
      });
    });

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      stderrBuf += text;
      // Surface stderr lines via progress so the UI log can show them too.
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) opts.onProgress?.(line);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn IndexTTS2 (${resolveBinary()}): ${err.message}`));
    });

    proc.on('close', (code) => {
      if (stdoutBuf) opts.onProgress?.(stdoutBuf);
      if (code === 0) {
        const duration = Number(lastProgress.duration_seconds) || 0;
        resolve({
          outputPath: opts.outputPath,
          durationSeconds: duration,
          totalElapsedMs: Date.now() - startedAt,
        });
        return;
      }
      // Try to extract a structured error from stderr.
      let message = `IndexTTS2 exited with code ${code}`;
      const trimmed = stderrBuf.trim();
      if (trimmed) {
        try {
          const last = trimmed.split(/\r?\n/).filter(Boolean).pop();
          if (last) {
            const parsed = JSON.parse(last);
            if (parsed?.error) {
              message = `IndexTTS2: ${parsed.error}`;
            }
          }
        } catch {
          message = `IndexTTS2 exited with code ${code}: ${trimmed.slice(-500)}`;
        }
      }
      reject(new Error(message));
    });
  });
}
