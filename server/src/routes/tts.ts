import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { cloneVoiceTTS } from '../services/indextts2.js';
import { createJob, getJob, updateJob } from '../services/ttsJobs.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// TTS outputs live under server/public/audio/tts so they're served by the
// existing /audio static handler (already wired in server/src/index.ts and
// proxied by Vite). Keeping this consistent with how other audio is delivered.
const TTS_OUTPUT_DIR = path.resolve(__dirname, '../../public/audio/tts');
const TTS_TMP_DIR = path.join(os.tmpdir(), 'acestep-tts');

// Match the upload limits/types used by /api/generate/upload-audio so the
// reference voice picker behaves identically.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3',
      'audio/wav', 'audio/x-wav',
      'audio/flac', 'audio/x-flac',
      'audio/mp4', 'audio/x-m4a', 'audio/aac',
      'audio/ogg', 'audio/webm',
      'video/mp4',
    ];
    const allowedExtensions = ['.mp3', '.wav', '.flac', '.m4a', '.mp4', '.aac', '.ogg', '.webm', '.opus'];
    const fileExt = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (allowedTypes.includes(file.mimetype) || (fileExt && allowedExtensions.includes(fileExt))) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Received: ${file.mimetype} (${file.originalname})`));
    }
  },
});

const cpUpload = upload.fields([
  { name: 'refAudio', maxCount: 1 },
  { name: 'emoAudio', maxCount: 1 },
]);

function pickFile(
  files: { [field: string]: Express.Multer.File[] } | undefined,
  field: string,
): Express.Multer.File | undefined {
  return files?.[field]?.[0];
}

function extForFile(file: Express.Multer.File): string {
  const fromName = path.extname(file.originalname || '').toLowerCase();
  if (fromName) return fromName;
  switch (file.mimetype) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return '.mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return '.wav';
    case 'audio/flac':
    case 'audio/x-flac':
      return '.flac';
    case 'audio/ogg':
      return '.ogg';
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/aac':
      return '.m4a';
    case 'audio/webm':
      return '.webm';
    default:
      return '.audio';
  }
}

router.post(
  '/clone',
  authMiddleware,
  (req: AuthenticatedRequest, res: Response, next: Function) => {
    cpUpload(req, res, (err: any) => {
      if (err) {
        res.status(400).json({ error: err.message || 'Invalid upload' });
        return;
      }
      next();
    });
  },
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
      const refFile = pickFile(files, 'refAudio');
      if (!refFile) {
        res.status(400).json({ error: 'refAudio file is required' });
        return;
      }
      const text = (req.body.text || '').toString().trim();
      if (!text) {
        res.status(400).json({ error: 'text is required' });
        return;
      }

      // Optional fields
      const emoAlpha = req.body.emoAlpha !== undefined ? Number(req.body.emoAlpha) : undefined;
      const emoText = req.body.emoText ? String(req.body.emoText) : undefined;
      let emoVector: number[] | undefined;
      if (req.body.emoVector) {
        try {
          const parsed = JSON.parse(req.body.emoVector);
          if (Array.isArray(parsed) && parsed.length === 8 && parsed.every(n => typeof n === 'number')) {
            emoVector = parsed;
          } else {
            res.status(400).json({ error: 'emoVector must be a JSON array of 8 numbers' });
            return;
          }
        } catch {
          res.status(400).json({ error: 'emoVector must be valid JSON' });
          return;
        }
      }
      const fp16 = req.body.fp16 === undefined ? true : String(req.body.fp16) === 'true';
      const seed = req.body.seed !== undefined && req.body.seed !== '' ? Number(req.body.seed) : undefined;
      const intervalSilence = req.body.intervalSilence !== undefined && req.body.intervalSilence !== ''
        ? Number(req.body.intervalSilence)
        : undefined;

      // Stage tmp files for the subprocess and ensure output dir exists.
      await mkdir(TTS_TMP_DIR, { recursive: true });
      await mkdir(TTS_OUTPUT_DIR, { recursive: true });

      const job = createJob();
      const refPath = path.join(TTS_TMP_DIR, `${job.id}-ref${extForFile(refFile)}`);
      await writeFile(refPath, refFile.buffer);

      let emoPath: string | undefined;
      const emoFile = pickFile(files, 'emoAudio');
      if (emoFile) {
        emoPath = path.join(TTS_TMP_DIR, `${job.id}-emo${extForFile(emoFile)}`);
        await writeFile(emoPath, emoFile.buffer);
      }

      const outputPath = path.join(TTS_OUTPUT_DIR, `${job.id}.wav`);
      const audioUrl = `/audio/tts/${job.id}.wav`;

      // Respond immediately; run inference in the background.
      res.json({ jobId: job.id });

      updateJob(job.id, { status: 'running', progress: 0.05, appendLog: 'queued' });

      cloneVoiceTTS({
        refAudioPath: refPath,
        text,
        outputPath,
        emoAudioPath: emoPath,
        emoAlpha,
        emoText,
        emoVector,
        fp16,
        intervalSilence,
        seed,
        onProgress: (line) => {
          const current = getJob(job.id);
          let progress = current?.progress ?? 0.05;
          if (line.includes('phase=loading')) progress = 0.15;
          else if (line.includes('phase=snapshot_download')) progress = 0.2;
          else if (line.includes('phase=generating')) progress = 0.5;
          else if (line.includes('phase=done')) progress = 0.95;
          updateJob(job.id, { appendLog: line, progress });
        },
      })
        .then((result) => {
          updateJob(job.id, {
            status: 'completed',
            progress: 1,
            result: { audioUrl, durationSeconds: result.durationSeconds },
            appendLog: `done in ${result.totalElapsedMs}ms (${result.durationSeconds.toFixed(2)}s audio)`,
          });
        })
        .catch((err: Error) => {
          console.error('[tts] clone failed:', err);
          updateJob(job.id, {
            status: 'failed',
            error: err.message || 'IndexTTS2 inference failed',
            appendLog: `error: ${err.message}`,
          });
        })
        .finally(async () => {
          // Best-effort cleanup of the staged ref/emo files.
          for (const p of [refPath, emoPath]) {
            if (!p) continue;
            try { await unlink(p); } catch { /* ignore */ }
          }
        });
    } catch (error) {
      console.error('TTS clone error:', error);
      res.status(500).json({ error: (error as Error).message || 'TTS clone failed' });
    }
  },
);

router.get('/status/:jobId', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

export default router;
