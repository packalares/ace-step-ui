import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { loadLora, unloadLora, setLoraScale, toggleLora, getLoraStatus } from '../services/acestep.js';

const router = Router();

// POST /api/lora/load
router.post('/load', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { lora_path, adapter_name } = req.body;
    if (!lora_path || typeof lora_path !== 'string') {
      res.status(400).json({ error: 'lora_path is required' });
      return;
    }
    const message = await loadLora(lora_path, adapter_name);
    res.json({ message, lora_path, loaded: true });
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
