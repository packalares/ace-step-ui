import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { pool } from '../db/pool.js';
import { generateUUID } from '../db/sqlite.js';
import { config } from '../config/index.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { isACEStepAvailable } from "../services/acestep.js";
import {
  generateMusicViaAPI,
  getJobStatus,
  getAudioStream,
  discoverEndpoints,
  checkSpaceHealth,
  cleanupJob,
  getJobRawResponse,
  downloadAudioToBuffer,
  resolvePythonPath,
  resolveAudioPath,
  fetchAPI,
} from '../services/acestep.js';
import { getStorageProvider } from '../services/storage/factory.js';

const router = Router();

// --- In-memory model download tracking ---
interface DownloadState {
  status: 'downloading' | 'done' | 'failed';
  error?: string;
  startedAt: number;
}
const downloadingModels = new Map<string, DownloadState>();

// Auto-generate a song title from lyrics or style when none is provided
function autoTitle(params: { title?: string; lyrics?: string; instrumental?: boolean; style?: string; songDescription?: string }): string {
  if (params.title?.trim()) return params.title.trim();

  // Try first meaningful lyric line (skip section markers like [verse], [chorus])
  if (!params.instrumental && params.lyrics) {
    for (const line of params.lyrics.split('\n')) {
      const t = line.trim();
      if (t && !/^\[.*\]$/.test(t)) {
        return t.length > 40 ? t.slice(0, 40).trimEnd() + '…' : t;
      }
    }
  }

  // Fall back to first 4 words of style or description
  const source = params.style || params.songDescription || '';
  if (source) {
    const words = source.trim().split(/\s+/).slice(0, 4).join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  return 'Untitled';
}

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'audio/mpeg',
      'audio/mp3', // Alternative MIME type for MP3
      'audio/mpeg3',
      'audio/x-mpeg-3',
      'audio/wav',
      'audio/x-wav',
      'audio/flac',
      'audio/x-flac',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/ogg',
      'audio/webm',
      'video/mp4',
    ];

    // Also check file extension as fallback
    const allowedExtensions = ['.mp3', '.wav', '.flac', '.m4a', '.mp4', '.aac', '.ogg', '.webm', '.opus'];
    const fileExt = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];

    if (allowedTypes.includes(file.mimetype) || (fileExt && allowedExtensions.includes(fileExt))) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Only common audio formats are allowed. Received: ${file.mimetype} (${file.originalname})`));
    }
  }
});

interface GenerateBody {
  // Mode
  customMode: boolean;

  // Simple Mode
  songDescription?: string;

  // Custom Mode
  lyrics: string;
  style: string;
  title: string;

  // Common
  instrumental: boolean;
  vocalLanguage?: string;

  // Music Parameters
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;

  // Generation Settings
  inferenceSteps?: number;
  guidanceScale?: number;
  batchSize?: number;
  randomSeed?: boolean;
  seed?: number;
  thinking?: boolean;
  audioFormat?: 'mp3' | 'flac';
  inferMethod?: 'ode' | 'sde';
  shift?: number;

  // LM Parameters
  lmTemperature?: number;
  lmCfgScale?: number;
  lmTopK?: number;
  lmTopP?: number;
  lmNegativePrompt?: string;
  lmBackend?: 'pt' | 'vllm';
  lmModel?: string;

  // Expert Parameters
  referenceAudioUrl?: string;
  sourceAudioUrl?: string;
  referenceAudioTitle?: string;
  sourceAudioTitle?: string;
  audioCodes?: string;
  repaintingStart?: number;
  repaintingEnd?: number;
  instruction?: string;
  audioCoverStrength?: number;
  taskType?: string;
  useAdg?: boolean;
  cfgIntervalStart?: number;
  cfgIntervalEnd?: number;
  customTimesteps?: string;
  useCotMetas?: boolean;
  useCotCaption?: boolean;
  useCotLanguage?: boolean;
  autogen?: boolean;
  constrainedDecodingDebug?: boolean;
  allowLmBatch?: boolean;
  getScores?: boolean;
  getLrc?: boolean;
  scoreScale?: number;
  lmBatchChunkSize?: number;
  trackName?: string;
  completeTrackClasses?: string[];
  isFormatCaption?: boolean;

  // Model selection
  ditModel?: string;
}

router.post('/upload-audio', authMiddleware, (req: AuthenticatedRequest, res: Response, next: Function) => {
  audioUpload.single('audio')(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Invalid file upload' });
      return;
    }
    next();
  });
}, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Audio file is required' });
      return;
    }

    const storage = getStorageProvider();
    const extFromName = path.extname(req.file.originalname || '').toLowerCase();
    const extFromType = (() => {
      switch (req.file.mimetype) {
        case 'audio/mpeg':
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
        case 'video/mp4':
          return '.mp4';
        default:
          return '';
      }
    })();
    const ext = extFromName || extFromType || '.audio';
    const key = `references/${req.user!.id}/${Date.now()}-${generateUUID()}${ext}`;
    const storedKey = await storage.upload(key, req.file.buffer, req.file.mimetype);
    const publicUrl = storage.getPublicUrl(storedKey);

    res.json({ url: publicUrl, key: storedKey });
  } catch (error) {
    console.error('Upload reference audio error:', error);
    res.status(500).json({ error: 'Failed to upload audio' });
  }
});

router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      customMode,
      songDescription,
      lyrics,
      style,
      title,
      instrumental,
      vocalLanguage,
      duration,
      bpm,
      keyScale,
      timeSignature,
      inferenceSteps,
      guidanceScale,
      batchSize,
      randomSeed,
      seed,
      thinking,
      audioFormat,
      inferMethod,
      shift,
      lmTemperature,
      lmCfgScale,
      lmTopK,
      lmTopP,
      lmNegativePrompt,
      lmBackend,
      lmModel,
      referenceAudioUrl,
      sourceAudioUrl,
      referenceAudioTitle,
      sourceAudioTitle,
      audioCodes,
      repaintingStart,
      repaintingEnd,
      instruction,
      audioCoverStrength,
      taskType,
      useAdg,
      cfgIntervalStart,
      cfgIntervalEnd,
      customTimesteps,
      useCotMetas,
      useCotCaption,
      useCotLanguage,
      autogen,
      constrainedDecodingDebug,
      allowLmBatch,
      getScores,
      getLrc,
      scoreScale,
      lmBatchChunkSize,
      trackName,
      completeTrackClasses,
      isFormatCaption,
      ditModel,
    } = req.body as GenerateBody;

    if (!customMode && !songDescription) {
      res.status(400).json({ error: 'Song description required for simple mode' });
      return;
    }

    if (customMode && !style && !lyrics && !referenceAudioUrl) {
      res.status(400).json({ error: 'Style, lyrics, or reference audio required for custom mode' });
      return;
    }

    const params = {
      customMode,
      songDescription,
      lyrics,
      style,
      title,
      instrumental,
      vocalLanguage,
      duration,
      bpm,
      keyScale,
      timeSignature,
      inferenceSteps,
      guidanceScale,
      batchSize,
      randomSeed,
      seed,
      thinking,
      audioFormat,
      inferMethod,
      shift,
      lmTemperature,
      lmCfgScale,
      lmTopK,
      lmTopP,
      lmNegativePrompt,
      lmBackend,
      lmModel,
      referenceAudioUrl,
      sourceAudioUrl,
      referenceAudioTitle,
      sourceAudioTitle,
      audioCodes,
      repaintingStart,
      repaintingEnd,
      instruction,
      audioCoverStrength,
      taskType,
      useAdg,
      cfgIntervalStart,
      cfgIntervalEnd,
      customTimesteps,
      useCotMetas,
      useCotCaption,
      useCotLanguage,
      autogen,
      constrainedDecodingDebug,
      allowLmBatch,
      getScores,
      getLrc,
      scoreScale,
      lmBatchChunkSize,
      trackName,
      completeTrackClasses,
      isFormatCaption,
      ditModel,
    };

    // Create job record in database
    const localJobId = generateUUID();
    await pool.query(
      `INSERT INTO generation_jobs (id, user_id, status, params, created_at, updated_at)
       VALUES (?, ?, 'queued', ?, datetime('now'), datetime('now'))`,
      [localJobId, req.user!.id, JSON.stringify(params)]
    );

    // Start generation
    trackGeneration();
    const { jobId: hfJobId } = await generateMusicViaAPI(params);

    // Update job with ACE-Step task ID
    await pool.query(
      `UPDATE generation_jobs SET acestep_task_id = ?, status = 'running', updated_at = datetime('now') WHERE id = ?`,
      [hfJobId, localJobId]
    );

    res.json({
      jobId: localJobId,
      status: 'queued',
      queuePosition: 1,
    });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: (error as Error).message || 'Generation failed' });
  }
});

router.get('/status/:jobId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const jobResult = await pool.query(
      `SELECT id, user_id, acestep_task_id, status, params, result, error, created_at
       FROM generation_jobs
       WHERE id = ?`,
      [req.params.jobId]
    );

    if (jobResult.rows.length === 0) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const job = jobResult.rows[0];

    if (job.user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // If job is still running, check ACE-Step status
    if (['pending', 'queued', 'running'].includes(job.status) && job.acestep_task_id) {
      try {
        const aceStatus = await getJobStatus(job.acestep_task_id);

        if (aceStatus.status !== job.status) {
          // Use optimistic lock: only update if status hasn't changed (prevents duplicate song creation)
          let updateQuery = `UPDATE generation_jobs SET status = ?, updated_at = datetime('now')`;
          const updateParams: unknown[] = [aceStatus.status];

          if (aceStatus.status === 'succeeded' && aceStatus.result) {
            updateQuery += `, result = ?`;
            updateParams.push(JSON.stringify(aceStatus.result));
          } else if (aceStatus.status === 'failed' && aceStatus.error) {
            updateQuery += `, error = ?`;
            updateParams.push(aceStatus.error);
          }

          updateQuery += ` WHERE id = ? AND status = ?`;
          updateParams.push(req.params.jobId, job.status);

          const updateResult = await pool.query(updateQuery, updateParams);
          const wasUpdated = updateResult.rowCount > 0;

          // If succeeded AND we were the first to update (optimistic lock), create song records
          if (aceStatus.status === 'succeeded' && aceStatus.result && wasUpdated) {
            const params = typeof job.params === 'string' ? JSON.parse(job.params) : job.params;
            const audioUrls = aceStatus.result.audioUrls.filter((url: string) => {
              const lower = url.toLowerCase();
              return lower.endsWith('.mp3') || lower.endsWith('.flac') || lower.endsWith('.wav');
            });
            const localPaths: string[] = [];
            const storage = getStorageProvider();

            for (let i = 0; i < audioUrls.length; i++) {
              const audioUrl = audioUrls[i];
              const variationSuffix = audioUrls.length > 1 ? ` (v${i + 1})` : '';
              const songTitle = autoTitle(params) + variationSuffix;

              const songId = generateUUID();

              try {
                const { buffer } = await downloadAudioToBuffer(audioUrl);
                const ext = audioUrl.includes('.flac') ? '.flac' : '.mp3';
                const storageKey = `${req.user!.id}/${songId}${ext}`;
                await storage.upload(storageKey, buffer, `audio/${ext.slice(1)}`);
                const storedPath = storage.getPublicUrl(storageKey);

                await pool.query(
                  `INSERT INTO songs (id, user_id, title, lyrics, style, caption, audio_url,
                                      duration, bpm, key_scale, time_signature, tags, is_public, generation_params,
                                      created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
                  [
                    songId,
                    req.user!.id,
                    songTitle,
                    params.instrumental ? '[Instrumental]' : params.lyrics,
                    params.style,
                    params.style,
                    storedPath,
                    aceStatus.result.duration && aceStatus.result.duration > 0 ? aceStatus.result.duration : (params.duration && params.duration > 0 ? params.duration : 0),
                    aceStatus.result.bpm || params.bpm,
                    aceStatus.result.keyScale || params.keyScale,
                    aceStatus.result.timeSignature || params.timeSignature,
                    JSON.stringify([]),
                    JSON.stringify(params),
                  ]
                );

                localPaths.push(storedPath);
              } catch (downloadError) {
                console.error(`Failed to download audio ${i + 1}:`, downloadError);
                // Still create song record with remote URL
                await pool.query(
                  `INSERT INTO songs (id, user_id, title, lyrics, style, caption, audio_url,
                                      duration, bpm, key_scale, time_signature, tags, is_public, generation_params,
                                      created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
                  [
                    songId,
                    req.user!.id,
                    songTitle,
                    params.instrumental ? '[Instrumental]' : params.lyrics,
                    params.style,
                    params.style,
                    audioUrl,
                    aceStatus.result.duration && aceStatus.result.duration > 0 ? aceStatus.result.duration : (params.duration && params.duration > 0 ? params.duration : 0),
                    aceStatus.result.bpm || params.bpm,
                    aceStatus.result.keyScale || params.keyScale,
                    aceStatus.result.timeSignature || params.timeSignature,
                    JSON.stringify([]),
                    JSON.stringify(params),
                  ]
                );
                localPaths.push(audioUrl);
              }
            }

            aceStatus.result.audioUrls = localPaths;
            cleanupJob(job.acestep_task_id);
          }
        }

        res.json({
          jobId: req.params.jobId,
          status: aceStatus.status,
          queuePosition: aceStatus.queuePosition,
          etaSeconds: aceStatus.etaSeconds,
          progress: aceStatus.progress,
          stage: aceStatus.stage,
          result: aceStatus.result,
          error: aceStatus.error,
        });
        return;
      } catch (aceError) {
        console.error('ACE-Step status check error:', aceError);
      }
    }

    // Return stored status
    res.json({
      jobId: req.params.jobId,
      status: job.status,
      progress: undefined,
      stage: undefined,
      result: job.result && typeof job.result === 'string' ? JSON.parse(job.result) : job.result,
      error: job.error,
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Audio proxy endpoint
router.get('/audio', async (req, res: Response) => {
  try {
    const audioPath = req.query.path as string;
    if (!audioPath) {
      res.status(400).json({ error: 'Path required' });
      return;
    }

    const audioResponse = await getAudioStream(audioPath);

    if (!audioResponse.ok) {
      res.status(audioResponse.status).json({ error: 'Failed to fetch audio' });
      return;
    }

    const contentType = audioResponse.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const contentLength = audioResponse.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const reader = audioResponse.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: 'Failed to read audio stream' });
      return;
    }

    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(value);
      return pump();
    };

    await pump();
  } catch (error) {
    console.error('Audio proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/history', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, acestep_task_id, status, params, result, error, created_at
       FROM generation_jobs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user!.id]
    );

    res.json({ jobs: result.rows });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/endpoints', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const endpoints = await discoverEndpoints();
    res.json({ endpoints });
  } catch (error) {
    console.error('Discover endpoints error:', error);
    res.status(500).json({ error: 'Failed to discover endpoints' });
  }
});

router.get('/models', async (_req, res: Response) => {
  try {
    const ACESTEP_DIR = process.env.ACESTEP_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ACE-Step-1.5');
    const checkpointsDir = path.join(ACESTEP_DIR, 'checkpoints');

    // All known DiT models from ACE-Step's model_downloader.py registry:
    // - MAIN_MODEL_COMPONENTS includes "acestep-v15-turbo" (bundled with main download)
    // - SUBMODEL_REGISTRY includes the rest (separate HuggingFace repos, auto-downloaded on init)
    const ALL_DIT_MODELS = [
      'acestep-v15-turbo',             // default, from main model repo
      'acestep-v15-base',              // submodel
      'acestep-v15-sft',               // submodel
      'acestep-v15-turbo-shift1',      // submodel
      'acestep-v15-turbo-shift3',      // submodel
      'acestep-v15-turbo-continuous',   // submodel
    ];

    // Query ACE-Step /v1/model_inventory to get the currently loaded/active model
    let activeModel: string | null = null;
    try {
      const apiRes = await fetch(`${config.acestep.apiUrl}/v1/model_inventory`);
      if (apiRes.ok) {
        const data = await apiRes.json() as any;
        const invModels = data?.data?.models || [];
        const loaded = invModels.find((m: any) => m.is_loaded);
        if (loaded) {
          activeModel = loaded.name;
        }
      }
    } catch {
      // ACE-Step API unavailable
    }

    // Check which models are downloaded (exist on disk)
    // Matches ACE-Step's handler.py check_model_exists() and get_available_acestep_v15_models()
    const { existsSync, statSync } = await import('fs');
    const downloaded = new Set<string>();
    for (const model of ALL_DIT_MODELS) {
      const modelPath = path.join(checkpointsDir, model);
      try {
        if (existsSync(modelPath) && statSync(modelPath).isDirectory()) {
          downloaded.add(model);
        }
      } catch { /* skip */ }
    }

    // Also scan for any additional acestep-v15-* models on disk not in the registry
    // (e.g. user-trained or community models)
    try {
      const { readdirSync } = await import('fs');
      for (const entry of readdirSync(checkpointsDir)) {
        if (entry.startsWith('acestep-v15-') && statSync(path.join(checkpointsDir, entry)).isDirectory()) {
          downloaded.add(entry);
          if (!ALL_DIT_MODELS.includes(entry)) {
            ALL_DIT_MODELS.push(entry);
          }
        }
      }
    } catch { /* checkpoints dir may not exist */ }

    const models = ALL_DIT_MODELS.map(name => ({
      name,
      is_active: name === activeModel,
      is_preloaded: downloaded.has(name),
    }));

    // Sort: active first, then downloaded, then alphabetical
    models.sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      if (a.is_preloaded !== b.is_preloaded) return a.is_preloaded ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ models });
  } catch (error) {
    console.error('Models error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/generate/simple — Orchestrate Simple mode: get metadata + lyrics
router.post('/simple', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { description, genre, instrumental } = req.body as {
      description: string;
      genre?: string;
      instrumental?: boolean;
    };

    const apiUrl = config.acestep.apiUrl || 'http://localhost:8000';
    const userInput = [genre, description].filter(Boolean).join(' ').trim();

    // Get description: use user input if provided, otherwise get random from ACE-Step
    let caption = '';
    let language = 'en';

    if (userInput) {
      caption = userInput;
    } else {
      // No user input — get a random description
      try {
        const sampleRes = await fetch(`${apiUrl}/create_random_sample`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(10_000),
        });
        const sampleData = await sampleRes.json() as any;
        const sample = sampleData?.data || {};
        caption = sample.description || 'upbeat pop song';
        language = sample.vocal_language || 'en';
      } catch {
        caption = 'upbeat pop song';
      }
    }

    // Step 2: Generate lyrics if not instrumental (matching the language)
    let lyrics = '';
    if (!instrumental) {
      try {
        const ACESTEP_DIR = process.env.ACESTEP_PATH || '/app/ACE-Step-1.5';
        const lyricsModelsDir = path.join(ACESTEP_DIR, 'checkpoints', 'lyrics-models');

        let modelPath = '';
        try {
          const { readdirSync } = await import('fs');
          const files = readdirSync(lyricsModelsDir);
          const gguf = files.find((f: string) => f.endsWith('.gguf'));
          if (gguf) modelPath = path.join(lyricsModelsDir, gguf);
        } catch {}

        if (modelPath) {
          const __dirname_local = path.dirname(fileURLToPath(import.meta.url));
          const LYRICS_SCRIPT = path.join(__dirname_local, '../../scripts/lyrics_generate.py');

          const cmdArg = JSON.stringify({
            action: 'generate',
            model_path: modelPath,
            genre: genre || '',
            topic: caption,
            mood: '',
            language: language === 'unknown' ? 'english' : language,
          });

          lyrics = await new Promise<string>((resolve) => {
            const proc = spawn('python3', [LYRICS_SCRIPT, cmdArg], {
              cwd: ACESTEP_DIR,
              env: { ...process.env, ACESTEP_PATH: ACESTEP_DIR },
            });

            let stdout = '';
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', () => {});

            const timeout = setTimeout(() => { proc.kill('SIGTERM'); resolve(''); }, 120_000);

            proc.on('close', (code) => {
              clearTimeout(timeout);
              if (code === 0 && stdout) {
                try { resolve(JSON.parse(stdout.trim()).lyrics || ''); } catch { resolve(''); }
              } else resolve('');
            });
            proc.on('error', () => { clearTimeout(timeout); resolve(''); });
          });
        }
      } catch {}
    }

    res.json({
      caption,
      lyrics: instrumental ? '[Instrumental]' : lyrics,
      language,
    });
  } catch (error) {
    console.error('Simple generate error:', error);
    res.status(500).json({ error: (error as Error).message || 'Simple generation failed' });
  }
});

// GET /api/generate/random-description — Load a random simple description from ACE-Step
router.get('/random-description', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const apiUrl = config.acestep.apiUrl || 'http://localhost:8000';
    const lang = (req.query.lang as string) || '';
    const maxTries = lang ? 10 : 1;

    for (let attempt = 0; attempt < maxTries; attempt++) {
      const apiRes = await fetch(`${apiUrl}/create_random_sample`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await apiRes.json() as any;
      const sample = data?.data || data || {};
      const sampleLang = sample.vocal_language || 'unknown';

      // If no lang filter or it matches, return immediately
      if (!lang || sampleLang === lang || sampleLang === 'unknown') {
        res.json({
          description: sample.description || sample.caption || sample.prompt || '',
          instrumental: sample.instrumental || false,
          vocalLanguage: sampleLang,
        });
        return;
      }
    }

    // Exhausted tries, return the last result anyway
    const apiRes = await fetch(`${apiUrl}/create_random_sample`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await apiRes.json() as any;
    const sample = data?.data || data || {};
    res.json({
      description: sample.description || sample.caption || sample.prompt || '',
      instrumental: sample.instrumental || false,
      vocalLanguage: sample.vocal_language || 'unknown',
    });
  } catch (error) {
    console.error('Random description error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/health', async (_req, res: Response) => {
  try {
    const apiUrl = config.acestep.apiUrl || "http://localhost:8000";
    const healthRes = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const healthy = healthRes.ok;
    res.json({ healthy, aceStepUrl: config.acestep.apiUrl });
  } catch (error) {
    res.json({ healthy: false, aceStepUrl: config.acestep.apiUrl, error: (error as Error).message });
  }
});

router.get('/limits', async (_req, res: Response) => {
  try {
    const { spawn } = await import('child_process');
    const ACESTEP_DIR = process.env.ACESTEP_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ACE-Step-1.5');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const SCRIPTS_DIR = path.join(__dirname, '../../scripts');
    const LIMITS_SCRIPT = path.join(SCRIPTS_DIR, 'get_limits.py');
    const pythonPath = resolvePythonPath(ACESTEP_DIR);

    const result = await new Promise<{ success: boolean; data?: any; error?: string }>((resolve) => {
      const proc = spawn(pythonPath, [LIMITS_SCRIPT], {
        cwd: ACESTEP_DIR,
        env: {
          ...process.env,
          ACESTEP_PATH: ACESTEP_DIR,
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && stdout) {
          try {
            const parsed = JSON.parse(stdout);
            resolve({ success: true, data: parsed });
          } catch {
            resolve({ success: false, error: 'Failed to parse limits result' });
          }
        } else {
          resolve({ success: false, error: stderr || 'Failed to read limits' });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });

    if (result.success && result.data) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error || 'Failed to load limits' });
    }
  } catch (error) {
    console.error('Limits error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/debug/:taskId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawResponse = getJobRawResponse(req.params.taskId);
    if (!rawResponse) {
      res.status(404).json({ error: 'Job not found or no raw response available' });
      return;
    }
    res.json({ rawResponse });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Format endpoint - uses LLM to enhance style/lyrics
router.post('/format', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { caption, lyrics, bpm, duration, keyScale, timeSignature, temperature, topK, topP, lmModel, lmBackend } = req.body;

    if (!caption) {
      res.status(400).json({ error: 'Caption/style is required' });
      return;
    }

    const ACESTEP_API_URL = config.acestep.apiUrl;

    // Build param_obj for the REST API
    const paramObj: Record<string, unknown> = {};
    if (bpm && bpm > 0) paramObj.bpm = bpm;
    if (duration && duration > 0) paramObj.duration = duration;
    if (keyScale) paramObj.key = keyScale;
    if (timeSignature) paramObj.time_signature = timeSignature;

    // Primary path: call ACE-Step's /format_input REST endpoint (avoids Python spawn ENOENT on Windows)
    try {
      console.log(`[Format] Calling REST API: ${ACESTEP_API_URL}/format_input`);
      const apiRes = await fetch(`${ACESTEP_API_URL}/format_input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: caption,
          lyrics: lyrics || '',
          temperature: temperature ?? 0.85,
          param_obj: paramObj,
        }),
        signal: AbortSignal.timeout(300_000), // 5 min — LLM may need to init first
      });

      const apiData = await apiRes.json() as any;

      if (!apiRes.ok || apiData.code !== 200) {
        const errMsg = apiData.error || apiData.detail || `Format API returned ${apiRes.status}`;
        console.error('[Format] API error:', errMsg);
        res.status(500).json({ success: false, error: errMsg });
        return;
      }

      const d = apiData.data;
      res.json({
        caption: d.caption,
        lyrics: d.lyrics,
        bpm: d.bpm,
        duration: d.duration,
        key_scale: d.key_scale,
        time_signature: d.time_signature,
        vocal_language: d.vocal_language,
      });
      return;
    } catch (fetchErr: any) {
      // Only fall back to Python spawn on network errors (service not yet reachable)
      if (fetchErr?.name !== 'AbortError' && (fetchErr?.code === 'ECONNREFUSED' || fetchErr?.cause?.code === 'ECONNREFUSED')) {
        console.warn('[Format] REST API unreachable, falling back to Python spawn');
      } else {
        console.error('[Format] REST API request failed:', fetchErr?.message);
        res.status(500).json({ success: false, error: fetchErr?.message || 'Format request failed' });
        return;
      }
    }

    // Fallback: Python spawn (only reached when REST API is unreachable)
    const { spawn } = await import('child_process');
    const ACESTEP_DIR = process.env.ACESTEP_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ACE-Step-1.5');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const SCRIPTS_DIR = path.join(__dirname, '../../scripts');
    const FORMAT_SCRIPT = path.join(SCRIPTS_DIR, 'format_sample.py');
    const pythonPath = resolvePythonPath(ACESTEP_DIR);

    const args = [FORMAT_SCRIPT, '--caption', caption, '--json'];
    if (lyrics) args.push('--lyrics', lyrics);
    if (bpm && bpm > 0) args.push('--bpm', String(bpm));
    if (duration && duration > 0) args.push('--duration', String(duration));
    if (keyScale) args.push('--key-scale', keyScale);
    if (timeSignature) args.push('--time-signature', timeSignature);
    if (temperature !== undefined) args.push('--temperature', String(temperature));
    if (topK && topK > 0) args.push('--top-k', String(topK));
    if (topP !== undefined) args.push('--top-p', String(topP));
    if (lmModel) args.push('--lm-model', lmModel);
    if (lmBackend) args.push('--lm-backend', lmBackend);

    console.log(`[Format] Fallback spawn: ${pythonPath} ${args.join(' ')}`);
    const result = await new Promise<{ success: boolean; data?: any; error?: string }>((resolve) => {
      const proc = spawn(pythonPath, args, {
        cwd: ACESTEP_DIR,
        env: { ...process.env, ACESTEP_PATH: ACESTEP_DIR },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && stdout) {
          const lines = stdout.trim().split('\n');
          let jsonStr = '';
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].startsWith('{')) { jsonStr = lines[i]; break; }
          }
          try {
            const parsed = JSON.parse(jsonStr || stdout);
            resolve({ success: true, data: parsed });
          } catch {
            console.error('[Format] Failed to parse stdout:', stdout.slice(0, 500));
            resolve({ success: false, error: 'Failed to parse format result' });
          }
        } else {
          console.error(`[Format] Process exited with code ${code}`);
          if (stdout) console.error('[Format] stdout:', stdout.slice(0, 1000));
          if (stderr) console.error('[Format] stderr:', stderr.slice(0, 1000));
          resolve({ success: false, error: stderr || stdout || `Format process exited with code ${code}` });
        }
      });

      proc.on('error', (err) => {
        console.error('[Format] Spawn error:', err.message);
        resolve({ success: false, error: err.message });
      });
    });

    if (result.success && result.data) {
      res.json(result.data);
    } else {
      console.error('[Format] Python error:', result.error);
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('[Format] Route error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/generate/inventory — proxy to ACE-Step's /v1/model_inventory
router.get('/inventory', async (_req, res: Response) => {
  try {
    const apiUrl = config.acestep.apiUrl || 'http://localhost:8000';
    const apiRes = await fetch(`${apiUrl}/v1/model_inventory`, { signal: AbortSignal.timeout(10000) });
    if (!apiRes.ok) {
      res.status(apiRes.status).json({ error: `ACE-Step returned ${apiRes.status}` });
      return;
    }
    const data = await apiRes.json();
    res.json(data);
  } catch (error) {
    console.error('Model inventory error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/generate/models/switch — proxy to ACE-Step's /v1/init
router.post('/models/switch', async (req, res: Response) => {
  try {
    const { model, init_llm, lm_model_path } = req.body;
    if (!model) {
      res.status(400).json({ error: 'model name is required' });
      return;
    }
    const apiUrl = config.acestep.apiUrl || 'http://localhost:8000';

    const body: Record<string, unknown> = { model };
    if (init_llm) body.init_llm = true;
    if (lm_model_path) body.lm_model_path = lm_model_path;
    const apiRes = await fetch(`${apiUrl}/v1/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    });
    if (!apiRes.ok) {
      const errData = await apiRes.json().catch(() => ({}));
      res.status(apiRes.status).json({ error: (errData as any).detail || `ACE-Step returned ${apiRes.status}` });
      return;
    }
    const data = await apiRes.json();
    res.json(data);
  } catch (error) {
    console.error('Model switch error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/generate/models/download — start downloading a model in the background
router.post('/models/download', async (req, res: Response) => {
  try {
    const { model } = req.body;
    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: 'model name is required' });
      return;
    }

    // Don't allow downloading the same model twice simultaneously
    const existing = downloadingModels.get(model);
    if (existing && existing.status === 'downloading') {
      res.json({ status: 'downloading', model, message: 'Download already in progress' });
      return;
    }

    const ACESTEP_DIR = process.env.ACESTEP_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ACE-Step-1.5');
    const checkpointsDir = path.join(ACESTEP_DIR, 'checkpoints');
    const pythonPath = resolvePythonPath(ACESTEP_DIR);

    // Mark as downloading
    downloadingModels.set(model, { status: 'downloading', startedAt: Date.now() });

    // Return immediately
    res.json({ status: 'downloading', model });

    // Spawn the Python download process in the background
    const pythonCode = `from acestep.api.model_download import ensure_model_downloaded; print(ensure_model_downloaded('${model.replace(/'/g, "\\'")}', '${checkpointsDir.replace(/'/g, "\\'")}'))`;

    const proc = spawn(pythonPath, ['-c', pythonCode], {
      cwd: ACESTEP_DIR,
      env: {
        ...process.env,
        ACESTEP_PATH: ACESTEP_DIR,
        PYTHONPATH: ACESTEP_DIR,
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`[ModelDownload] ${model} stdout:`, data.toString().trim());
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // HuggingFace Hub prints progress to stderr, so only log, don't treat as error
      console.log(`[ModelDownload] ${model} stderr:`, data.toString().trim());
    });

    // Set a 10-minute timeout
    const timeout = setTimeout(() => {
      console.error(`[ModelDownload] ${model} timed out after 10 minutes`);
      proc.kill('SIGTERM');
      downloadingModels.set(model, { status: 'failed', error: 'Download timed out after 10 minutes', startedAt: Date.now() });
    }, 10 * 60 * 1000);

    proc.on('close', async (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        console.log(`[ModelDownload] ${model} completed successfully`);
        downloadingModels.set(model, { status: 'done', startedAt: Date.now() });

        // Automatically call /v1/init to load the model after download
        try {
          const apiUrl = config.acestep.apiUrl || 'http://localhost:8000';
          console.log(`[ModelDownload] Initializing model ${model} via /v1/init`);
          const initRes = await fetch(`${apiUrl}/v1/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model }),
            signal: AbortSignal.timeout(300000), // 5 min for model loading
          });
          if (initRes.ok) {
            console.log(`[ModelDownload] Model ${model} loaded successfully`);
          } else {
            console.warn(`[ModelDownload] /v1/init returned ${initRes.status} for ${model}`);
          }
        } catch (initErr) {
          console.warn(`[ModelDownload] Failed to auto-init model ${model}:`, (initErr as Error).message);
        }
      } else {
        const errorMsg = stderr || stdout || `Process exited with code ${code}`;
        console.error(`[ModelDownload] ${model} failed:`, errorMsg);
        downloadingModels.set(model, { status: 'failed', error: errorMsg, startedAt: Date.now() });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`[ModelDownload] ${model} spawn error:`, err.message);
      downloadingModels.set(model, { status: 'failed', error: err.message, startedAt: Date.now() });
    });
  } catch (error) {
    console.error('Model download error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/generate/models/download-status — poll download progress
router.get('/models/download-status', async (_req, res: Response) => {
  try {
    const downloads: Record<string, { status: string; error?: string }> = {};
    downloadingModels.forEach((state, model) => {
      downloads[model] = { status: state.status, ...(state.error ? { error: state.error } : {}) };
    });
    res.json({ downloads });
  } catch (error) {
    console.error('Download status error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Extract codes from source audio
// ---------------------------------------------------------------------------
router.post('/extract-codes', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { audioUrl } = req.body as { audioUrl: string };
    if (!audioUrl) {
      res.status(400).json({ error: 'audioUrl is required' });
      return;
    }

    const srcPath = resolveAudioPath(audioUrl);

    const submitResp = await fetchAPI('/release_task', {
      task_type: 'text2music',
      extract_codes_only: true,
      src_audio_path: srcPath,
      prompt: '',
      lyrics: '',
    });

    const taskId = submitResp?.data?.task_id;
    if (!taskId) {
      res.status(500).json({ error: 'No task_id from ACE-Step' });
      return;
    }

    // Poll for completion (up to 2 minutes)
    const maxWaitMs = 2 * 60 * 1000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, pollIntervalMs));

      const resp = await fetchAPI('/query_result', {
        task_id_list: JSON.stringify([taskId]),
      });

      const data = resp?.data;
      if (!Array.isArray(data) || data.length === 0) continue;

      const job = data[0];
      const status = job.status; // 0=running, 1=succeeded, 2=failed

      if (status === 1) {
        let resultItems: any[] = [];
        try {
          resultItems = typeof job.result === 'string' ? JSON.parse(job.result) : (job.result || []);
        } catch { resultItems = []; }

        const audioCodes = resultItems[0]?.audio_codes || '';
        res.json({ codes: audioCodes });
        return;
      }

      if (status === 2) {
        let resultItems: any[] = [];
        try {
          resultItems = typeof job.result === 'string' ? JSON.parse(job.result) : (job.result || []);
        } catch { resultItems = []; }
        const errorMsg = resultItems[0]?.error || job.progress_text || 'Extract codes failed';
        res.status(500).json({ error: errorMsg });
        return;
      }
    }

    res.status(504).json({ error: 'Extract codes timed out after 2 minutes' });
  } catch (error) {
    console.error('Extract codes error:', error);
    res.status(500).json({ error: (error as Error).message || 'Extract codes failed' });
  }
});

// ---------------------------------------------------------------------------
// Full analysis (transcribe) from source audio
// ---------------------------------------------------------------------------
router.post('/full-analysis', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { audioUrl } = req.body as { audioUrl: string };
    if (!audioUrl) {
      res.status(400).json({ error: 'audioUrl is required' });
      return;
    }

    const srcPath = resolveAudioPath(audioUrl);

    const submitResp = await fetchAPI('/release_task', {
      task_type: 'text2music',
      full_analysis_only: true,
      src_audio_path: srcPath,
      prompt: '',
      lyrics: '',
    });

    const taskId = submitResp?.data?.task_id;
    if (!taskId) {
      res.status(500).json({ error: 'No task_id from ACE-Step' });
      return;
    }

    // Poll for completion (up to 2 minutes)
    const maxWaitMs = 2 * 60 * 1000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, pollIntervalMs));

      const resp = await fetchAPI('/query_result', {
        task_id_list: JSON.stringify([taskId]),
      });

      const data = resp?.data;
      if (!Array.isArray(data) || data.length === 0) continue;

      const job = data[0];
      const status = job.status;

      if (status === 1) {
        let resultItems: any[] = [];
        try {
          resultItems = typeof job.result === 'string' ? JSON.parse(job.result) : (job.result || []);
        } catch { resultItems = []; }

        const item = resultItems[0] || {};
        const metas = item.metas || {};
        res.json({
          codes: item.audio_codes || '',
          bpm: metas.bpm,
          key: metas.keyscale,
          timeSignature: metas.timesignature,
          duration: metas.duration,
          genre: metas.genre,
          prompt: metas.prompt,
          lyrics: metas.lyrics,
          language: metas.language,
        });
        return;
      }

      if (status === 2) {
        let resultItems: any[] = [];
        try {
          resultItems = typeof job.result === 'string' ? JSON.parse(job.result) : (job.result || []);
        } catch { resultItems = []; }
        const errorMsg = resultItems[0]?.error || job.progress_text || 'Full analysis failed';
        res.status(500).json({ error: errorMsg });
        return;
      }
    }

    res.status(504).json({ error: 'Full analysis timed out after 2 minutes' });
  } catch (error) {
    console.error('Full analysis error:', error);
    res.status(500).json({ error: (error as Error).message || 'Full analysis failed' });
  }
});

// --- GPU Unload: kill ACE-Step Python and restart fresh ---

let lastGenerationTime = Date.now();
let autoUnloadTimer: ReturnType<typeof setTimeout> | null = null;
let autoUnloadMinutes = 0; // 0 = disabled

// Track last generation time
function trackGeneration() {
  lastGenerationTime = Date.now();
  resetAutoUnloadTimer();
}

function resetAutoUnloadTimer() {
  if (autoUnloadTimer) clearTimeout(autoUnloadTimer);
  if (autoUnloadMinutes > 0) {
    autoUnloadTimer = setTimeout(() => {
      console.log(`[AutoUnload] ${autoUnloadMinutes}min idle — unloading GPU models`);
      restartAceStep().catch(err => console.error('[AutoUnload] Failed:', err));
    }, autoUnloadMinutes * 60 * 1000);
  }
}

async function restartAceStep(): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if training is running
    const apiUrl = config.acestep.apiUrl || 'http://127.0.0.1:8000';
    try {
      const statusRes = await fetch(`${apiUrl}/v1/training/status`, { signal: AbortSignal.timeout(3000) });
      if (statusRes.ok) {
        const data = await statusRes.json() as any;
        if (data?.data?.is_training) {
          return { success: false, error: 'Cannot unload while training is in progress' };
        }
      }
    } catch { /* API might be down already */ }

    // Kill Python process
    const { execSync } = await import('child_process');
    try {
      execSync("pkill -f 'from acestep.api_server'", { timeout: 5000 });
    } catch { /* might already be dead */ }

    // Wait a moment for process to die
    await new Promise(r => setTimeout(r, 2000));

    // Restart ACE-Step in background
    const aceStepDir = process.env.ACESTEP_PATH || '/app/ACE-Step-1.5';
    const proc = spawn('python3', ['-c', `
import sys; sys.path.insert(0, '${aceStepDir}')
from acestep.api_server import create_app
import uvicorn
app = create_app()
uvicorn.run(app, host='0.0.0.0', port=8000)
`], {
      cwd: aceStepDir,
      env: { ...process.env, ACESTEP_PATH: aceStepDir },
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();

    // Wait for health check
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const healthRes = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (healthRes.ok) {
          return { success: true };
        }
      } catch { /* not ready yet */ }
    }

    return { success: false, error: 'ACE-Step did not restart within 60 seconds' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// POST /api/generate/gpu/unload — kill ACE-Step and restart fresh (frees GPU memory)
router.post('/gpu/unload', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await restartAceStep();
    if (result.success) {
      res.json({ status: 'GPU models unloaded. ACE-Step restarted in lazy mode.' });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/generate/gpu/status — check GPU memory and loaded models
router.get('/gpu/status', async (_req, res: Response) => {
  try {
    const apiUrl = config.acestep.apiUrl || 'http://127.0.0.1:8000';
    let inventory = null;
    try {
      const invRes = await fetch(`${apiUrl}/v1/model_inventory`, { signal: AbortSignal.timeout(3000) });
      if (invRes.ok) inventory = await invRes.json();
    } catch { /* API might be down */ }

    res.json({
      aceStepRunning: !!inventory,
      inventory: inventory?.data || null,
      lastGenerationTime,
      idleMinutes: Math.round((Date.now() - lastGenerationTime) / 60000),
      autoUnloadMinutes,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/generate/gpu/auto-unload — set auto-unload timer (0 = disabled)
router.post('/gpu/auto-unload', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { minutes } = req.body;
    autoUnloadMinutes = Math.max(0, Math.min(480, Number(minutes) || 0));
    resetAutoUnloadTimer();
    res.json({
      autoUnloadMinutes,
      status: autoUnloadMinutes > 0
        ? `Auto-unload set to ${autoUnloadMinutes} minutes of idle time`
        : 'Auto-unload disabled',
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
