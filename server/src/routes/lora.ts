import { Router, Response } from 'express';
import path from 'path';
import { existsSync } from 'fs';
import { config } from '../config/index.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { loadLora, unloadLora, setLoraScale, toggleLora, getLoraStatus } from '../services/acestep.js';

const router = Router();

// `lora_path` arrives straight from the request body. Confine it to the
// ACE-Step install tree (which holds lora_output/ and checkpoints/) before
// touching the filesystem: without this the existsSync probes below double as
// an existence oracle for arbitrary paths, and ACE-Step would happily be asked
// to load an adapter from anywhere on disk.
const ACESTEP_BASE = path.resolve(config.datasets.dir, '..');

function confineToAceStepDir(loraPath: string): string {
  const resolved = path.resolve(ACESTEP_BASE, loraPath);
  const rel = path.relative(ACESTEP_BASE, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathOutsideBaseError();
  }
  return resolved;
}

class PathOutsideBaseError extends Error {
  constructor() {
    super('lora_path must resolve inside the ACE-Step directory');
  }
}

// ACE-Step expects `lora_path` to be a PEFT LoRA directory containing
// adapter_config.json directly. Callers sometimes pass the training root
// or its `final` dir instead of the actual adapter dir (trainer.py saves
// to <output_dir>/final/adapter — see python/acestep_patches/trainer.py).
// Resolve defensively; fall back to the confined path if nothing matches.
function resolveAdapterPath(loraPath: string): string {
  const base = confineToAceStepDir(loraPath);
  if (existsSync(path.join(base, 'adapter_config.json'))) {
    return base;
  }
  const candidates = [
    path.join(base, 'final', 'adapter'),
    path.join(base, 'adapter'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'adapter_config.json'))) {
      return candidate;
    }
  }
  return base;
}

// POST /api/lora/load
router.post('/load', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { lora_path, adapter_name } = req.body;
    if (!lora_path || typeof lora_path !== 'string') {
      res.status(400).json({ error: 'lora_path is required' });
      return;
    }
    let resolvedPath: string;
    try {
      resolvedPath = resolveAdapterPath(lora_path);
    } catch (err) {
      if (err instanceof PathOutsideBaseError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
    const message = await loadLora(resolvedPath, adapter_name);
    res.json({ message, lora_path: resolvedPath, loaded: true });
  } catch (error) {
    console.error('[LoRA] Load error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load LoRA' });
  }
});

// POST /api/lora/unload
router.post('/unload', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const message = await unloadLora();
    res.json({ message });
  } catch (error) {
    console.error('[LoRA] Unload error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to unload LoRA' });
  }
});

// POST /api/lora/scale
router.post('/scale', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { scale, adapter_name } = req.body;
    if (typeof scale !== 'number' || scale < 0 || scale > 1) {
      res.status(400).json({ error: 'scale must be a number between 0 and 1' });
      return;
    }
    const message = await setLoraScale(scale, adapter_name);
    res.json({ message, scale });
  } catch (error) {
    console.error('[LoRA] Scale error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to set LoRA scale' });
  }
});

// POST /api/lora/toggle
router.post('/toggle', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { enabled } = req.body;
    const useLora = typeof enabled === 'boolean' ? enabled : true;
    const message = await toggleLora(useLora);
    res.json({ message, active: useLora });
  } catch (error) {
    console.error('[LoRA] Toggle error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to toggle LoRA' });
  }
});

// GET /api/lora/status
router.get('/status', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await getLoraStatus();
    res.json(status?.data || { loaded: false, active: false, scale: 1.0 });
  } catch (error) {
    res.json({ loaded: false, active: false, scale: 1.0 });
  }
});

export default router;
