// Single source of truth for model catalogs

export const DIT_MODELS: Record<string, { description: string; size: string }> = {
  'acestep-v15-xl-turbo': { description: 'XL (4B). Distilled for speed — 8 steps, no CFG. Highest clarity.', size: '9 GB' },
  'acestep-v15-xl-sft': { description: 'XL (4B). Supervised fine-tuned. 50 steps + CFG, best prompt adherence.', size: '9 GB' },
  'acestep-v15-xl-base': { description: 'XL (4B). Foundation model — all tasks + fine-tuning. 50 steps + CFG.', size: '9 GB' },
};

export const LM_MODELS: Record<string, { description: string; size: string }> = {
  'acestep-5Hz-lm-0.6B': { description: 'Qwen3 Embedding. Lightweight, always loaded.', size: '1.2 GB' },
  'acestep-5Hz-lm-1.7B': { description: 'Medium LM. Good balance of quality and speed.', size: '3.5 GB' },
  'acestep-5Hz-lm-4B': { description: 'Large LM. Best prompt understanding.', size: '7.9 GB' },
};

export const LYRICS_MODELS = [
  { id: 'llama-song-stream-3b-q4', name: 'Song Stream 3B (Q4)', description: 'Fast, good quality', size: '2.0 GB', repo: 'prithivMLmods/Llama-Song-Stream-3B-Instruct-GGUF', filename: 'Llama-Song-Stream-3B-Instruct.Q4_K_M.gguf' },
  { id: 'llama-song-stream-3b-q8', name: 'Song Stream 3B (Q8)', description: 'Higher quality, more RAM', size: '3.5 GB', repo: 'prithivMLmods/Llama-Song-Stream-3B-Instruct-GGUF', filename: 'Llama-Song-Stream-3B-Instruct.Q8_0.gguf' },
];

// Short display names for DiT models
export function getModelDisplayName(modelId: string): string {
  const mapping: Record<string, string> = {
    'acestep-v15-xl-turbo': 'XLT', 'acestep-v15-xl-sft': 'XLS',
    'acestep-v15-xl-base': 'XLB',
  };
  return mapping[modelId] || modelId.replace('acestep-v15-', '');
}

export function isTurboModel(modelId: string): boolean {
  return modelId.includes('turbo');
}
