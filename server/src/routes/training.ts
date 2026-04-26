import { Router, Request, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { resolvePythonPath } from '../services/acestep.js';
import { separateStems } from '../services/audioSeparator.js';
import { createJob, getJob, updateJob } from '../services/stemJobs.js';
import multer from 'multer';
import path from 'path';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { execSync, spawn } from 'child_process';
import { randomUUID } from 'crypto';

const router = Router();

// --- Helper: call ACE-Step REST API ---
async function aceStepFetch(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    timeoutMs?: number;
  } = {},
): Promise<any> {
  const apiUrl = config.acestep.apiUrl;
  const { method = 'GET', body, timeoutMs = 30_000 } = options;

  const fetchOpts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body) {
    fetchOpts.body = JSON.stringify(body);
  }

  const res = await fetch(`${apiUrl}${endpoint}`, fetchOpts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = (data as any)?.detail || (data as any)?.error || `ACE-Step API error: ${res.status}`;
    const err = new Error(msg);
    (err as any).status = res.status;
    throw err;
  }

  return data;
}

// --- Audio upload via multer disk storage ---
const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg', '.opus'];

const audioStorage = multer.diskStorage({
  destination: async (_req: Request, _file, cb) => {
    const datasetName = (_req.body?.datasetName as string) || 'default';
    const dest = path.join(config.datasets.uploadsDir, datasetName);
    try {
      await mkdir(dest, { recursive: true });
      cb(null, dest);
    } catch (err) {
      cb(err as Error, dest);
    }
  },
  filename: (_req, file, cb) => {
    // Preserve original filename but ensure uniqueness
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext);
    const safeName = base.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    cb(null, `${safeName}${ext}`);
  },
});

const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per file
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (AUDIO_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Allowed: ${AUDIO_EXTENSIONS.join(', ')}`));
    }
  },
});

// Get audio duration via ffprobe
function getAudioDuration(filePath: string): number {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const duration = parseFloat(result.trim());
    return isNaN(duration) ? 0 : Math.round(duration);
  } catch {
    return 0;
  }
}

// Resolve ACE-Step base directory
function getAceStepDir(): string {
  const envPath = process.env.ACESTEP_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  return path.resolve(config.datasets.dir, '..');
}

// ================== ROUTES ==================

// POST /api/training/upload-audio — Upload audio files for a dataset
router.post('/upload-audio', authMiddleware, audioUpload.array('audio', 50), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No audio files uploaded' });
      return;
    }

    const datasetName = (req.body?.datasetName as string) || 'default';
    const uploadDir = path.join(config.datasets.uploadsDir, datasetName);

    res.json({
      files: files.map(f => ({
        filename: f.filename,
        originalName: f.originalname,
        size: f.size,
        path: f.path,
      })),
      uploadDir,
      count: files.length,
    });
  } catch (error) {
    console.error('[Training] Upload audio error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Upload failed' });
  }
});

// POST /api/training/build-dataset — Scan audio directory + create dataset JSON
router.post('/build-dataset', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      datasetName = 'my_lora_dataset',
      customTag = '',
      tagPosition = 'prepend',
      allInstrumental = true,
    } = req.body;

    const audioDir = path.join(config.datasets.uploadsDir, datasetName);
    if (!existsSync(audioDir)) {
      res.status(400).json({ error: `Audio directory not found: uploads/${datasetName}` });
      return;
    }

    // Scan for audio files
    const entries = readdirSync(audioDir);
    const audioFiles = entries.filter(f => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    if (audioFiles.length === 0) {
      res.status(400).json({ error: 'No audio files found in directory' });
      return;
    }

    // Build samples
    const samples = audioFiles.map(filename => {
      const audioPath = path.join(audioDir, filename);
      const duration = getAudioDuration(audioPath);
      const baseName = path.basename(filename, path.extname(filename));

      // Check for companion .txt lyrics file
      let rawLyrics = '';
      const lyricsPath = path.join(audioDir, `${baseName}.txt`);
      if (existsSync(lyricsPath)) {
        try {
          rawLyrics = readFileSync(lyricsPath, 'utf-8').trim();
        } catch { /* ignore */ }
      }

      const isInstrumental = allInstrumental || !rawLyrics;

      return {
        id: randomUUID().slice(0, 8),
        audio_path: audioPath,
        filename,
        caption: '',
        genre: '',
        lyrics: isInstrumental ? '[Instrumental]' : rawLyrics,
        raw_lyrics: rawLyrics,
        formatted_lyrics: '',
        bpm: null as number | null,
        keyscale: '',
        timesignature: '',
        duration,
        language: isInstrumental ? 'instrumental' : 'unknown',
        is_instrumental: isInstrumental,
        custom_tag: customTag,
        labeled: false,
        prompt_override: null as string | null,
      };
    });

    // Build dataset JSON
    const dataset = {
      metadata: {
        name: datasetName,
        custom_tag: customTag,
        tag_position: tagPosition,
        created_at: new Date().toISOString(),
        num_samples: samples.length,
        all_instrumental: allInstrumental,
        genre_ratio: 0,
      },
      samples,
    };

    // Save JSON to datasets dir
    await mkdir(config.datasets.dir, { recursive: true });
    const jsonPath = path.join(config.datasets.dir, `${datasetName}.json`);
    await writeFile(jsonPath, JSON.stringify(dataset, null, 2), 'utf-8');

    // Load into ACE-Step via REST API
    try {
      const data = await aceStepFetch('/v1/dataset/load', {
        method: 'POST',
        body: { dataset_path: jsonPath },
      });

      res.json({
        status: data.status || `Dataset built (${samples.length} samples)`,
        dataframe: data.dataframe || null,
        sampleCount: samples.length,
        sample: data.sample || (samples.length > 0 ? {
          index: 0,
          audio: null,
          filename: samples[0].filename,
          caption: samples[0].caption,
          genre: samples[0].genre,
          promptOverride: null,
          lyrics: samples[0].lyrics,
          bpm: samples[0].bpm,
          key: samples[0].keyscale,
          timeSignature: samples[0].timesignature,
          duration: samples[0].duration,
          language: samples[0].language,
          instrumental: samples[0].is_instrumental,
          rawLyrics: samples[0].raw_lyrics,
        } : null),
        settings: data.settings || {
          datasetName,
          customTag,
          tagPosition,
          allInstrumental,
          genreRatio: 0,
        },
        datasetPath: jsonPath,
      });
    } catch (apiError) {
      // API may not be running — still return dataset info
      console.warn('[Training] ACE-Step API load failed, returning dataset JSON only:', apiError);
      res.json({
        status: `Dataset saved (${samples.length} samples). ACE-Step API not available for live preview.`,
        dataframe: null,
        sampleCount: samples.length,
        sample: samples.length > 0 ? {
          index: 0,
          audio: null,
          filename: samples[0].filename,
          caption: samples[0].caption,
          genre: samples[0].genre,
          promptOverride: null,
          lyrics: samples[0].lyrics,
          bpm: samples[0].bpm,
          key: samples[0].keyscale,
          timeSignature: samples[0].timesignature,
          duration: samples[0].duration,
          language: samples[0].language,
          instrumental: samples[0].is_instrumental,
          rawLyrics: samples[0].raw_lyrics,
        } : null,
        settings: {
          datasetName,
          customTag,
          tagPosition,
          allInstrumental,
          genreRatio: 0,
        },
        datasetPath: jsonPath,
      });
    }
  } catch (error) {
    console.error('[Training] Build dataset error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to build dataset' });
  }
});

// GET /api/training/audio — Proxy audio files from datasets directory
router.get('/audio', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let filePath: string;
    const aceStepDir = getAceStepDir();

    if (req.query.path) {
      filePath = req.query.path as string;
    } else if (req.query.file) {
      // Relative path within datasets dir
      filePath = path.join(config.datasets.dir, req.query.file as string);
    } else {
      res.status(400).json({ error: 'path or file parameter required' });
      return;
    }

    // Path traversal protection
    const resolved = path.resolve(filePath);
    if (resolved.includes('..') || !resolved.startsWith(aceStepDir)) {
      res.status(403).json({ error: 'Access denied: path outside ACE-Step directory' });
      return;
    }

    if (!existsSync(resolved)) {
      res.status(404).json({ error: 'Audio file not found' });
      return;
    }

    // Determine content type
    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/opus',
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.sendFile(resolved);
  } catch (error) {
    console.error('[Training] Audio proxy error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to serve audio' });
  }
});

// POST /api/training/preprocess — Start async preprocessing via ACE-Step REST API
router.post('/preprocess', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { datasetPath, outputDir } = req.body;
    if (!datasetPath) {
      res.status(400).json({ error: 'datasetPath is required' });
      return;
    }

    const resolvedOutput = outputDir || path.join(config.datasets.dir, 'preprocessed_tensors');

    const data = await aceStepFetch('/v1/dataset/preprocess_async', {
      method: 'POST',
      body: { dataset_path: datasetPath, output_dir: resolvedOutput },
      timeoutMs: 30_000,
    });

    const innerP = data.data || data;
    res.json({
      task_id: innerP.task_id,
      status: innerP.message || innerP.status || 'Preprocessing started',
    });
  } catch (error) {
    console.error('[Training] Preprocess error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Preprocessing failed' });
  }
});

// GET /api/training/preprocess-status — Poll preprocessing progress
router.get('/preprocess-status', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await aceStepFetch('/v1/dataset/preprocess_status');
    res.json(data);
  } catch (error) {
    console.error('[Training] Preprocess status error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to get preprocess status' });
  }
});

// POST /api/training/scan-directory — Scan a directory for audio files (Node.js implementation)
router.post('/scan-directory', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      audioDir,
      datasetName = 'my_lora_dataset',
      customTag = '',
      tagPosition = 'prepend',
      allInstrumental = true,
    } = req.body;

    if (!audioDir || typeof audioDir !== 'string') {
      res.status(400).json({ error: 'audioDir is required' });
      return;
    }

    // Resolve path — if relative, resolve from ACE-Step dir
    const aceStepDir = getAceStepDir();
    const resolvedDir = path.isAbsolute(audioDir)
      ? audioDir
      : path.resolve(aceStepDir, audioDir);

    if (!existsSync(resolvedDir)) {
      res.status(400).json({ error: `Directory not found: ${audioDir}` });
      return;
    }

    // Scan for audio files
    const entries = readdirSync(resolvedDir);
    const audioFiles = entries.filter(f => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    if (audioFiles.length === 0) {
      res.status(400).json({ error: 'No audio files found in directory' });
      return;
    }

    // Build table data: [#, Filename, Duration, Lyrics, Labeled, BPM, Key, Caption]
    const tableHeaders = ['#', 'Filename', 'Duration', 'Lyrics', 'Labeled', 'BPM', 'Key', 'Caption'];
    const tableData = audioFiles.map((filename, i) => {
      const audioPath = path.join(resolvedDir, filename);
      const duration = getAudioDuration(audioPath);
      const baseName = path.basename(filename, path.extname(filename));

      // Check for companion .txt lyrics file
      let lyrics = allInstrumental ? '[Instrumental]' : '';
      const lyricsPath = path.join(resolvedDir, `${baseName}.txt`);
      if (existsSync(lyricsPath)) {
        try {
          lyrics = readFileSync(lyricsPath, 'utf-8').trim().slice(0, 50) + '...';
        } catch { /* ignore */ }
      }

      return [i + 1, filename, `${duration}s`, lyrics, '❌', '', '', ''];
    });

    res.json({
      status: `Found ${audioFiles.length} audio files`,
      dataframe: {
        headers: tableHeaders,
        data: tableData,
      },
      sampleCount: audioFiles.length,
      audioDir: resolvedDir,
    });
  } catch (error) {
    console.error('[Training] Scan directory error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to scan directory' });
  }
});

// POST /api/training/auto-label — Auto-label dataset samples (async)
router.post('/auto-label', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      skipMetas = false,
      formatLyrics = false,
      transcribeLyrics = false,
      onlyUnlabeled = false,
    } = req.body;

    const data = await aceStepFetch('/v1/dataset/auto_label_async', {
      method: 'POST',
      body: {
        skip_metas: skipMetas,
        format_lyrics: formatLyrics,
        transcribe_lyrics: transcribeLyrics,
        only_unlabeled: onlyUnlabeled,
      },
      timeoutMs: 30_000,
    });

    const inner = data.data || data;
    res.json({
      task_id: inner.task_id,
      total: inner.total,
      status: inner.message || inner.status || 'Auto-labeling started',
    });
  } catch (error) {
    console.error('[Training] Auto-label error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Auto-label failed' });
  }
});

// GET /api/training/auto-label-status — Poll auto-label progress
router.get('/auto-label-status', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await aceStepFetch('/v1/dataset/auto_label_status');
    res.json(data);
  } catch (error) {
    console.error('[Training] Auto-label status error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to get auto-label status' });
  }
});

// POST /api/training/init-model — Initialize or change model for training
router.post('/init-model', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      checkpoint,
      initLlm = false,
      lmModelPath = '',
      reinitialize = false,
    } = req.body;

    // Force-load model weights if requested (needed when ACESTEP_NO_INIT=true)
    if (reinitialize) {
      await aceStepFetch('/v1/reinitialize', {
        method: 'POST',
        body: {},
        timeoutMs: 300_000,
      });
    }

    const data = await aceStepFetch('/v1/init', {
      method: 'POST',
      body: {
        model: checkpoint ?? '',
        init_llm: initLlm,
        lm_model_path: lmModelPath,
      },
      timeoutMs: 300_000,
    });

    res.json({
      status: data.status || 'Model initialized',
      modelReady: data.model_ready ?? true,
    });
  } catch (error) {
    console.error('[Training] Init model error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Model init failed' });
  }
});

// GET /api/training/checkpoints — List available model checkpoints
router.get('/checkpoints', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const aceStepDir = getAceStepDir();
    const checkpointDir = path.join(aceStepDir, 'checkpoints');
    if (!existsSync(checkpointDir)) {
      res.json({ checkpoints: [], configs: [] });
      return;
    }

    // List checkpoint directories
    const entries = readdirSync(checkpointDir);
    const checkpoints = entries.filter(e => {
      const fullPath = path.join(checkpointDir, e);
      return statSync(fullPath).isDirectory();
    });

    // List config directories (acestep-v15-*)
    const configDirs = entries.filter(e =>
      e.startsWith('acestep-v15') && statSync(path.join(checkpointDir, e)).isDirectory()
    );

    res.json({ checkpoints, configs: configDirs });
  } catch (error) {
    console.error('[Training] List checkpoints error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list checkpoints' });
  }
});

// GET /api/training/lora-checkpoints — List LoRA training checkpoints in output dir
router.get('/lora-checkpoints', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const outputDir = (req.query.dir as string) || './lora_output';
    const aceStepDir = getAceStepDir();
    const resolvedDir = path.isAbsolute(outputDir)
      ? outputDir
      : path.resolve(aceStepDir, outputDir);

    if (!existsSync(resolvedDir)) {
      res.json({ checkpoints: [] });
      return;
    }

    const entries = readdirSync(resolvedDir);
    const checkpointsDir = path.join(resolvedDir, 'checkpoints');
    const checkpoints: string[] = [];

    if (existsSync(checkpointsDir)) {
      const cpEntries = readdirSync(checkpointsDir);
      cpEntries.forEach(e => {
        if (statSync(path.join(checkpointsDir, e)).isDirectory()) {
          checkpoints.push(path.join(checkpointsDir, e));
        }
      });
    }

    // Also check for "final" directory
    const finalDir = path.join(resolvedDir, 'final');
    if (existsSync(finalDir)) {
      checkpoints.push(finalDir);
    }

    res.json({ checkpoints, outputDir: resolvedDir });
  } catch (error) {
    console.error('[Training] List LoRA checkpoints error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list checkpoints' });
  }
});

// POST /api/training/load-dataset — Load an existing dataset JSON for preprocessing
router.post('/load-dataset', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { datasetPath } = req.body;
    if (!datasetPath || typeof datasetPath !== 'string') {
      res.status(400).json({ error: 'datasetPath is required' });
      return;
    }
    // Reject path traversal
    if (datasetPath.includes('..')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    const data = await aceStepFetch('/v1/dataset/load', {
      method: 'POST',
      body: { dataset_path: datasetPath },
    });

    res.json(data);
  } catch (error) {
    console.error('[Training] Load dataset error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to load dataset' });
  }
});

// GET /api/training/sample-preview — Get preview data for a specific sample
router.get('/sample-preview', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idx = parseInt(req.query.idx as string) || 0;

    const data = await aceStepFetch(`/v1/dataset/sample/${idx}`);
    const sample = data.data || data;

    // Map ACE-Step field names to our frontend field names
    res.json({
      audio: sample.audio_path,
      filename: sample.filename,
      caption: sample.caption || '',
      genre: sample.genre || '',
      promptOverride: sample.prompt_override || 'Use Global Ratio',
      lyrics: sample.lyrics || '',
      bpm: sample.bpm || null,
      key: sample.keyscale || '',
      timeSignature: sample.timesignature || '',
      duration: sample.duration || 0,
      language: sample.language || 'unknown',
      instrumental: sample.is_instrumental ?? true,
      rawLyrics: sample.raw_lyrics || '',
    });
  } catch (error) {
    console.error('[Training] Sample preview error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to get sample preview' });
  }
});

// POST /api/training/save-sample — Save edits to a dataset sample
router.post('/save-sample', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sampleIdx, caption, genre, promptOverride, lyrics, bpm, key, timeSignature, language, instrumental } = req.body;

    const idx = sampleIdx ?? 0;
    const data = await aceStepFetch(`/v1/dataset/sample/${idx}`, {
      method: 'PUT',
      body: {
        sample_idx: idx,
        caption: caption ?? '',
        genre: genre ?? '',
        prompt_override: promptOverride ?? null,
        lyrics: lyrics ?? '',
        bpm: bpm || null,
        keyscale: key ?? '',
        timesignature: timeSignature ?? '',
        language: language ?? 'instrumental',
        is_instrumental: instrumental ?? true,
      },
    });

    res.json(data);
  } catch (error) {
    console.error('[Training] Save sample error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to save sample edit' });
  }
});

// POST /api/training/update-settings — Update dataset global settings
router.post('/update-settings', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true });
});

// POST /api/training/save-dataset — Save the dataset to a JSON file
router.post('/save-dataset', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { savePath, datasetName, customTag, tagPosition, allInstrumental, genreRatio } = req.body;

    const resolvedPath = (savePath ?? `./datasets/${datasetName ?? 'my_lora_dataset'}.json`).trim();

    const body: Record<string, unknown> = {
      save_path: resolvedPath,
      dataset_name: datasetName ?? 'my_lora_dataset',
    };
    if (customTag !== undefined) body.custom_tag = customTag;
    if (tagPosition !== undefined) body.tag_position = tagPosition;
    if (allInstrumental !== undefined) body.all_instrumental = allInstrumental;
    if (genreRatio !== undefined) body.genre_ratio = genreRatio;

    const data = await aceStepFetch('/v1/dataset/save', {
      method: 'POST',
      body,
    });

    res.json({
      status: data.status ?? 'Saved',
      path: data.save_path ?? resolvedPath,
    });
  } catch (error) {
    console.error('[Training] Save dataset error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to save dataset' });
  }
});

// POST /api/training/load-tensors — Load preprocessed tensors for training
router.post('/load-tensors', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tensorDir } = req.body;

    const data = await aceStepFetch('/v1/training/load_tensor_info', {
      method: 'POST',
      body: { tensor_dir: tensorDir ?? './datasets/preprocessed_tensors' },
    });

    res.json(data);
  } catch (error) {
    console.error('[Training] Load tensors error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to load training dataset' });
  }
});

// POST /api/training/start — Start LoRA training
router.post('/start', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      tensorDir, rank, alpha, dropout, learningRate,
      epochs, batchSize, gradientAccumulation, saveEvery,
      shift, seed, outputDir, resumeCheckpoint,
    } = req.body;

    const data = await aceStepFetch('/v1/training/start', {
      method: 'POST',
      body: {
        tensor_dir: tensorDir ?? './datasets/preprocessed_tensors',
        rank: rank ?? 64,
        alpha: alpha ?? 128,
        dropout: dropout ?? 0.1,
        learning_rate: learningRate ?? 0.0003,
        epochs: epochs ?? 1000,
        batch_size: batchSize ?? 1,
        gradient_accumulation: gradientAccumulation ?? 1,
        save_every: saveEvery ?? 200,
        shift: shift ?? 3.0,
        seed: seed ?? 42,
        output_dir: outputDir ?? './lora_output',
        resume_checkpoint: resumeCheckpoint ?? null,
      },
      timeoutMs: 300_000, // training start can take time
    });

    res.json(data);
  } catch (error) {
    console.error('[Training] Start training error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to start training' });
  }
});

// GET /api/training/training-status — Poll training progress
router.get('/training-status', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await aceStepFetch('/v1/training/status');
    res.json(data);
  } catch (error) {
    console.error('[Training] Training status error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to get training status' });
  }
});

// POST /api/training/stop — Stop current training
router.post('/stop', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await aceStepFetch('/v1/training/stop', { method: 'POST' });
    res.json(data);
  } catch (error) {
    console.error('[Training] Stop training error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to stop training' });
  }
});

// POST /api/training/export — Export trained LoRA weights
router.post('/export', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { exportPath, loraOutputDir } = req.body;

    const data = await aceStepFetch('/v1/training/export', {
      method: 'POST',
      body: {
        export_path: exportPath ?? './lora_output/final_lora',
        lora_output_dir: loraOutputDir ?? './lora_output',
      },
    });

    res.json(data);
  } catch (error) {
    console.error('[Training] Export LoRA error:', error);
    const status = (error as any).status || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to export LoRA' });
  }
});

// --- Stem extraction preprocessing ----------------------------------------
// Replaces the browser-side Demucs popup. Wraps audio-separator (CUDA) to
// isolate vocals/instruments before training.
//
// The frontend just sends the upload dataset name + the resolved
// preprocessing block from data/training-categories.json. We resolve the
// input/output dirs relative to config.datasets.uploadsDir and create a
// sibling dataset suffixed `_stems` so the original raw uploads stay intact.
//
// Body shape:
//   {
//     datasetName: string,            // existing folder under uploadsDir
//     category: string,
//     subType?: string | null,
//     preprocessing: { model, keepStems?, chain?, extraArgs? }
//   }
//
// Response: { jobId, total, outputDatasetName, outputDir }

router.post('/preprocess-stems', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { datasetName, category, subType, preprocessing } = (req.body ?? {}) as {
    datasetName?: string;
    category?: string;
    subType?: string | null;
    preprocessing?: {
      model?: string;
      keepStems?: string[];
      chain?: string[];
      extraArgs?: Record<string, unknown>;
    };
  };

  if (!datasetName || !category || !preprocessing?.model) {
    return res.status(400).json({
      error: 'datasetName, category, and preprocessing.model are required',
    });
  }

  const inputDir = path.join(config.datasets.uploadsDir, datasetName);
  const outputDatasetName = `${datasetName}_stems`;
  const outputDir = path.join(config.datasets.uploadsDir, outputDatasetName);

  if (!existsSync(inputDir)) {
    return res.status(404).json({ error: `dataset not found: ${datasetName}` });
  }

  // Discover audio files in inputDir.
  const inputs = readdirSync(inputDir)
    .filter((f) => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map((f) => path.join(inputDir, f));

  if (inputs.length === 0) {
    return res.status(400).json({ error: 'no audio files found in inputDir' });
  }

  await mkdir(outputDir, { recursive: true });

  const job = createJob(inputs.length);
  res.json({
    jobId: job.id,
    total: inputs.length,
    category,
    subType,
    outputDatasetName,
    outputDir,
  });

  // Background work — fire and forget.
  void (async () => {
    try {
      updateJob(job.id, { status: 'running' });
      const result = await separateStems({
        inputPaths: inputs,
        outputDir,
        model: preprocessing.model!,
        keepStems: preprocessing.keepStems,
        chain: preprocessing.chain,
        extraArgs: preprocessing.extraArgs,
        onStdout: (line) => {
          const cur = getJob(job.id);
          if (!cur) return;
          updateJob(job.id, { log: [...cur.log, line].slice(-200) });
        },
        onProgress: (msg) => {
          const m = msg.match(/(\d+)\s*%/);
          if (m) {
            const cur = getJob(job.id);
            if (!cur) return;
            // Approximate overall progress: per-file percent averaged across total inputs.
            const filePct = parseInt(m[1], 10);
            const overall = Math.round(((cur.current * 100 + filePct) / cur.total));
            updateJob(job.id, { progress: Math.min(99, overall) });
          }
        },
      });
      updateJob(job.id, { status: 'completed', progress: 100, current: inputs.length, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateJob(job.id, { status: 'failed', error: message });
    }
  })();
});

router.get('/preprocess-stems-status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const jobId = String(req.query.jobId ?? '');
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  return res.json(job);
});

export default router;
