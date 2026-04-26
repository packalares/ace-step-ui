// Types for the category-based LoRA training redesign.
//
// All category-specific configuration lives in `data/training-categories.json`.
// All Generate-panel preset configuration lives in `data/style-presets.json`.
// These types mirror the JSON shapes so consumers stay strongly typed.

export type TrainingCategoryId =
  | 'voice'
  | 'instrument'
  | 'drum_component'
  | 'instrumental'
  | 'genre'
  | 'mood'
  | 'producer'
  | 'groove';

export type TagPosition = 'prepend' | 'append' | 'replace';

export interface PreprocessingConfig {
  /** Whether the stem-extraction preprocessing step runs at all. */
  enabled: boolean;
  /** audio-separator model filename (or special id e.g. "larsnet"). */
  model: string;
  /** Stems to retain after separation, e.g. ["vocals"] or ["drums"]. */
  keepStems: string[];
  /**
   * For chained pipelines (e.g. drum component splitting), the ordered list of
   * models that are applied in sequence after the primary `model` step.
   */
  chain?: string[];
  /** Pass-through arguments for the audio-separator CLI. */
  extraArgs?: Record<string, unknown>;
  /**
   * If the preferred model is unavailable on the server, the backend may fall
   * back to this filename instead.
   */
  fallbackModel?: string;
}

export interface AutoLabelConfig {
  /** Skip BPM/Key/TimeSig generation during auto-label. */
  skipMetas: boolean;
  /** Run lyrics transcription (Whisper) on each sample. */
  transcribeLyrics: boolean;
  /** Reformat/clean lyrics with the LM. */
  formatLyrics: boolean;
  /** Custom tag inserted into every caption (e.g. "voice clone, "). */
  customTag: string;
  /** Where the customTag is placed relative to the caption. */
  tagPosition: TagPosition;
}

export interface TrainingDefaults {
  rank: number;
  alpha: number;
  dropout: number;
  learningRate: number;
  epochs: number;
  batchSize: number;
  gradientAccumulation: number;
  saveEvery: number;
  /** Subdirectory appended to `outputRoot`, e.g. "voice", "instrument/drums". */
  outputSubdir: string;
}

export interface DatasetGuidance {
  minSamples: number;
  recommendedSamples: number;
  minSampleSeconds: number;
  maxSampleSeconds: number;
  /** Short user-facing instructions about what kind of clips to upload. */
  instructions: string;
}

export interface TrainingCategoryBase {
  displayName: string;
  description: string;
  /** Lucide icon name (string). Resolved via the icon map at render time. */
  icon: string;
  preprocessing: PreprocessingConfig;
  autoLabel: AutoLabelConfig;
  training: TrainingDefaults;
  dataset: DatasetGuidance;
}

export interface TrainingSubType {
  id: string;
  displayName: string;
  description?: string;
  icon?: string;
  preprocessing?: PreprocessingConfig;
  autoLabel?: AutoLabelConfig;
  training?: Partial<TrainingDefaults>;
  dataset?: Partial<DatasetGuidance>;
}

export interface TrainingCategoryConfig extends TrainingCategoryBase {
  id: TrainingCategoryId;
  /** Present for `instrument` and `drum_component`; absent for the rest. */
  subTypes?: TrainingSubType[];
}

export interface TrainingCategoriesFile {
  outputRoot: string;
  categories: TrainingCategoryConfig[];
}

/**
 * The fully-merged config used at runtime — parent values overlaid with the
 * selected sub-type's overrides. Returned by `useTrainingCategory()`.
 */
export interface ResolvedCategoryConfig {
  id: TrainingCategoryId;
  subTypeId: string | null;
  displayName: string;
  description: string;
  icon: string;
  preprocessing: PreprocessingConfig;
  autoLabel: AutoLabelConfig;
  training: TrainingDefaults;
  dataset: DatasetGuidance;
}

// === Style preset (Generate panel) ===

export interface StylePreset {
  id: string;
  displayName: string;
  /** Lucide icon name. */
  icon: string;
  description: string;
  /**
   * If true, this preset clears overrides instead of applying them — used for
   * the "Custom (no preset)" entry.
   */
  clear?: boolean;
  /** Free-form tags string applied to the Style/genre field. */
  tags?: string;
  /** CFG scale (guidance scale) for the diffusion sampler. */
  cfgScale?: number;
  inferenceSteps?: number;
  scheduler?: 'ode' | 'sde';
  cfgType?: 'apg' | 'cfg' | 'cfg_star';
  omegaScale?: number;
  guidanceInterval?: number;
  guidanceScaleText?: number;
  guidanceScaleLyric?: number;
  /** Suggested duration in seconds. -1 means "let the model decide". */
  duration?: number;
  useErgTag?: boolean;
  useErgDiffusion?: boolean;
}

export interface StylePresetsFile {
  presets: StylePreset[];
}
