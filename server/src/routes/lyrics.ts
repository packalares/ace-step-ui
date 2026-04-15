import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Lyrics model catalog ---
const LYRICS_MODEL_CATALOG = [
  {
    id: 'llama-song-stream-3b-q4',
    name: 'Song Stream 3B (Q4)',
    description: 'Fast, good quality lyrics generation',
    size: '2.0 GB',
    repo: 'prithivMLmods/Llama-Song-Stream-3B-Instruct-GGUF',
    filename: 'Llama-Song-Stream-3B-Instruct.Q4_K_M.gguf',
  },
  {
    id: 'llama-song-stream-3b-q8',
    name: 'Song Stream 3B (Q8)',
    description: 'Higher quality, uses more RAM',
    size: '3.5 GB',
    repo: 'prithivMLmods/Llama-Song-Stream-3B-Instruct-GGUF',
    filename: 'Llama-Song-Stream-3B-Instruct.Q8_0.gguf',
  },
];

// Paths
const ACESTEP_DIR = process.env.ACESTEP_PATH || path.resolve(__dirname, '../../../ACE-Step-1.5');
const LYRICS_MODELS_DIR = path.join(ACESTEP_DIR, 'checkpoints', 'lyrics-models');
const SCRIPT_PATH = path.join(__dirname, '../../scripts/lyrics_generate.py');

// Ensure lyrics models directory exists
try { fs.mkdirSync(LYRICS_MODELS_DIR, { recursive: true }); } catch { /* ignore */ }

// --- In-memory download tracking ---
interface DownloadState {
  status: 'downloading' | 'done' | 'failed';
  error?: string;
  startedAt: number;
}
const downloadingModels = new Map<string, DownloadState>();

// --- In-memory generation tracking ---
let generatingCount = 0;

function getModelPath(modelId: string): string | null {
  const catalog = LYRICS_MODEL_CATALOG.find(m => m.id === modelId);
  if (!catalog) return null;
  return path.join(LYRICS_MODELS_DIR, catalog.filename);
}

function isModelDownloaded(modelId: string): boolean {
  const modelPath = getModelPath(modelId);
  if (!modelPath) return false;
  return fs.existsSync(modelPath);
}

function getFirstDownloadedModel(): string | null {
  for (const m of LYRICS_MODEL_CATALOG) {
    if (isModelDownloaded(m.id)) return m.id;
  }
  return null;
}

function runPythonScript(args: Record<string, unknown>, timeoutMs = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const jsonArg = JSON.stringify(args);
    const proc = spawn('python3', [SCRIPT_PATH, jsonArg], {
      cwd: ACESTEP_DIR,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Script timed out'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || stdout || `Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// GET /api/lyrics/models — list available lyrics models with download status
router.get('/models', async (_req, res: Response) => {
  try {
    const models = LYRICS_MODEL_CATALOG.map(m => ({
      ...m,
      downloaded: isModelDownloaded(m.id),
      downloading: downloadingModels.get(m.id)?.status === 'downloading',
    }));
    res.json({ models });
  } catch (error) {
    console.error('List lyrics models error:', error);
    res.status(500).json({ error: 'Failed to list models' });
  }
});

// POST /api/lyrics/models/download — start downloading a lyrics model
router.post('/models/download', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { modelId } = req.body;
    if (!modelId || typeof modelId !== 'string') {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }

    const catalog = LYRICS_MODEL_CATALOG.find(m => m.id === modelId);
    if (!catalog) {
      res.status(400).json({ error: 'Unknown model ID' });
      return;
    }

    // Already downloaded?
    if (isModelDownloaded(modelId)) {
      res.json({ status: 'done', modelId });
      return;
    }

    // Already downloading?
    const existing = downloadingModels.get(modelId);
    if (existing && existing.status === 'downloading') {
      res.json({ status: 'downloading', modelId, message: 'Download already in progress' });
      return;
    }

    // Mark as downloading
    downloadingModels.set(modelId, { status: 'downloading', startedAt: Date.now() });

    // Return immediately
    res.json({ status: 'downloading', modelId });

    // Spawn download in background
    const args = {
      action: 'download',
      repo_id: catalog.repo,
      filename: catalog.filename,
      dest_dir: LYRICS_MODELS_DIR,
    };

    const jsonArg = JSON.stringify(args);
    const proc = spawn('python3', [SCRIPT_PATH, jsonArg], {
      cwd: ACESTEP_DIR,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`[LyricsDownload] ${modelId} stdout:`, data.toString().trim());
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log(`[LyricsDownload] ${modelId} stderr:`, data.toString().trim());
    });

    // 15-minute timeout for large model downloads
    const timeout = setTimeout(() => {
      console.error(`[LyricsDownload] ${modelId} timed out`);
      proc.kill('SIGTERM');
      downloadingModels.set(modelId, { status: 'failed', error: 'Download timed out after 15 minutes', startedAt: Date.now() });
    }, 15 * 60 * 1000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        console.log(`[LyricsDownload] ${modelId} completed successfully`);
        downloadingModels.set(modelId, { status: 'done', startedAt: Date.now() });
      } else {
        const errorMsg = stderr || stdout || `Process exited with code ${code}`;
        console.error(`[LyricsDownload] ${modelId} failed:`, errorMsg);
        downloadingModels.set(modelId, { status: 'failed', error: errorMsg, startedAt: Date.now() });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`[LyricsDownload] ${modelId} spawn error:`, err.message);
      downloadingModels.set(modelId, { status: 'failed', error: err.message, startedAt: Date.now() });
    });
  } catch (error) {
    console.error('Lyrics model download error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/lyrics/models/download-status — poll download progress
router.get('/models/download-status', async (_req, res: Response) => {
  try {
    const downloads: Record<string, { status: string; error?: string }> = {};
    downloadingModels.forEach((state, modelId) => {
      downloads[modelId] = { status: state.status, ...(state.error ? { error: state.error } : {}) };
    });
    res.json({ downloads });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/lyrics/generate — generate lyrics
router.post('/generate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { genre, language, topic, mood, structure, modelId } = req.body;

    // Resolve model
    const resolvedModelId = modelId || getFirstDownloadedModel();
    if (!resolvedModelId) {
      res.status(400).json({ error: 'No lyrics model downloaded. Please download one from Settings.' });
      return;
    }

    const modelPath = getModelPath(resolvedModelId);
    if (!modelPath || !fs.existsSync(modelPath)) {
      res.status(400).json({ error: `Model ${resolvedModelId} is not downloaded.` });
      return;
    }

    if (generatingCount > 0) {
      res.status(429).json({ error: 'A lyrics generation is already in progress. Please wait.' });
      return;
    }

    generatingCount++;
    console.log(`[Lyrics] Generating with model ${resolvedModelId}...`);

    try {
      const result = await runPythonScript({
        action: 'generate',
        model_path: modelPath,
        genre: genre || '',
        language: language || 'english',
        topic: topic || '',
        mood: mood || '',
        structure: structure || '',
      }, 120000);

      const parsed = JSON.parse(result);
      res.json(parsed);
    } finally {
      generatingCount--;
    }
  } catch (error) {
    console.error('Lyrics generate error:', error);
    res.status(500).json({ error: (error as Error).message || 'Generation failed' });
  }
});

// POST /api/lyrics/generate-full — generate all song fields from a description
router.post('/generate-full', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { description, modelId } = req.body;

    if (!description?.trim()) {
      res.status(400).json({ error: 'Description is required' });
      return;
    }

    // Resolve model
    const resolvedModelId = modelId || getFirstDownloadedModel();
    if (!resolvedModelId) {
      res.status(400).json({ error: 'No lyrics model downloaded. Please download one from Settings.' });
      return;
    }

    const modelPath = getModelPath(resolvedModelId);
    if (!modelPath || !fs.existsSync(modelPath)) {
      res.status(400).json({ error: `Model ${resolvedModelId} is not downloaded.` });
      return;
    }

    if (generatingCount > 0) {
      res.status(429).json({ error: 'A lyrics generation is already in progress. Please wait.' });
      return;
    }

    generatingCount++;
    console.log(`[Lyrics] Generating full song spec with model ${resolvedModelId}...`);

    try {
      const result = await runPythonScript({
        action: 'generate_full',
        model_path: modelPath,
        description: description,
      }, 120000);

      const parsed = JSON.parse(result);
      res.json(parsed);
    } finally {
      generatingCount--;
    }
  } catch (error) {
    console.error('Lyrics generate-full error:', error);
    res.status(500).json({ error: (error as Error).message || 'Generation failed' });
  }
});

export default router;
