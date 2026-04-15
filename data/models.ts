// Single source of truth for model catalogs

export const DIT_MODELS: Record<string, { description: string; size: string }> = {
  'acestep-v15-turbo': { description: 'Optimized for speed. Uses fewer inference steps (5-10).', size: '4.5 GB' },
  'acestep-v15-base': { description: 'Standard DiT model. Needs more steps (20-50).', size: '4.5 GB' },
  'acestep-v15-sft': { description: 'Supervised fine-tuned. Better prompt adherence.', size: '4.5 GB' },
  'acestep-v15-turbo-shift1': { description: 'Turbo variant with shift=1.', size: '4.5 GB' },
  'acestep-v15-turbo-shift3': { description: 'Turbo variant with shift=3. Warmer sound.', size: '4.5 GB' },
  'acestep-v15-turbo-continuous': { description: 'Continuous flow turbo. Experimental.', size: '4.5 GB' },
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
    'acestep-v15-base': '1.5B', 'acestep-v15-sft': '1.5S',
    'acestep-v15-turbo-shift1': '1.5TS1', 'acestep-v15-turbo-shift3': '1.5TS3',
    'acestep-v15-turbo-continuous': '1.5TC', 'acestep-v15-turbo': '1.5T',
  };
  return mapping[modelId] || modelId.replace('acestep-v15-', '');
}

export function isTurboModel(modelId: string): boolean {
  return modelId.includes('turbo');
}
