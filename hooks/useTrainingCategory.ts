import { useCallback, useEffect, useMemo, useState } from 'react';
import categoriesJson from '../data/training-categories.json';
import presetsJson from '../data/style-presets.json';
import type {
  ResolvedCategoryConfig,
  StylePreset,
  StylePresetsFile,
  TrainingCategoriesFile,
  TrainingCategoryConfig,
  TrainingCategoryId,
  TrainingDefaults,
  TrainingSubType,
} from '../types/training';

const STORAGE_KEY_CATEGORY = 'ace-trainingCategory';
const STORAGE_KEY_SUBTYPE = 'ace-trainingSubType';

const data = categoriesJson as TrainingCategoriesFile;
const presetsData = presetsJson as StylePresetsFile;

const CATEGORIES: TrainingCategoryConfig[] = data.categories as TrainingCategoryConfig[];
const PRESETS: StylePreset[] = presetsData.presets;

const VALID_IDS = new Set<TrainingCategoryId>(CATEGORIES.map(c => c.id));

function readStoredCategory(): TrainingCategoryId | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY_CATEGORY);
  if (raw && VALID_IDS.has(raw as TrainingCategoryId)) return raw as TrainingCategoryId;
  return null;
}

function readStoredSubType(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY_SUBTYPE);
}

export function getCategoryConfig(id: TrainingCategoryId | null): TrainingCategoryConfig | null {
  if (!id) return null;
  return CATEGORIES.find(c => c.id === id) ?? null;
}

export function getSubType(category: TrainingCategoryConfig | null, subTypeId: string | null): TrainingSubType | null {
  if (!category || !subTypeId || !category.subTypes) return null;
  return category.subTypes.find(s => s.id === subTypeId) ?? null;
}

/**
 * Merge a parent category config with the selected sub-type, deeply for the
 * sub-objects we care about (preprocessing, autoLabel, training, dataset).
 */
export function resolveCategory(
  category: TrainingCategoryConfig | null,
  subTypeId: string | null,
): ResolvedCategoryConfig | null {
  if (!category) return null;
  const sub = getSubType(category, subTypeId);
  if (!sub) {
    return {
      id: category.id,
      subTypeId: null,
      displayName: category.displayName,
      description: category.description,
      icon: category.icon,
      preprocessing: category.preprocessing,
      autoLabel: category.autoLabel,
      training: category.training,
      dataset: category.dataset,
    };
  }
  return {
    id: category.id,
    subTypeId: sub.id,
    displayName: `${category.displayName} – ${sub.displayName}`,
    description: sub.description ?? category.description,
    icon: sub.icon ?? category.icon,
    preprocessing: sub.preprocessing ?? category.preprocessing,
    autoLabel: sub.autoLabel ?? category.autoLabel,
    training: { ...category.training, ...(sub.training ?? {}) } as TrainingDefaults,
    dataset: { ...category.dataset, ...(sub.dataset ?? {}) },
  };
}

/**
 * Build the full lora_output path for a resolved category.
 * Format: `${outputRoot}/${outputSubdir}/${datasetName}` (datasetName optional).
 */
export function buildOutputDir(
  resolved: ResolvedCategoryConfig | null,
  datasetName?: string | null,
): string {
  const root = data.outputRoot.replace(/\/+$/, '');
  if (!resolved) return root;
  const subdir = resolved.training.outputSubdir.replace(/^\/+|\/+$/g, '');
  const base = subdir ? `${root}/${subdir}` : root;
  const trimmedName = (datasetName ?? '').trim();
  return trimmedName ? `${base}/${trimmedName}` : base;
}

export interface UseTrainingCategoryReturn {
  /** Available top-level categories (read from JSON). */
  categories: TrainingCategoryConfig[];
  /** All Generate-panel style presets (also exposed here for convenience). */
  presets: StylePreset[];
  /** Output root path (single source of truth, from JSON). */
  outputRoot: string;
  /** Currently selected category id, or null if none picked yet. */
  category: TrainingCategoryId | null;
  /** Currently selected sub-type id, or null. */
  subType: string | null;
  /** Resolved (parent+sub-type merged) config — null until a category is picked. */
  config: ResolvedCategoryConfig | null;
  /** Merged training defaults (alias of `config?.training`). */
  defaults: TrainingDefaults | null;
  setCategory: (id: TrainingCategoryId | null) => void;
  setSubType: (id: string | null) => void;
  buildOutputDir: (datasetName?: string | null) => string;
}

export function useTrainingCategory(): UseTrainingCategoryReturn {
  const [category, setCategoryState] = useState<TrainingCategoryId | null>(() => readStoredCategory());
  const [subType, setSubTypeState] = useState<string | null>(() => readStoredSubType());

  // Persist category to localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (category) window.localStorage.setItem(STORAGE_KEY_CATEGORY, category);
    else window.localStorage.removeItem(STORAGE_KEY_CATEGORY);
  }, [category]);

  // Persist sub-type to localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (subType) window.localStorage.setItem(STORAGE_KEY_SUBTYPE, subType);
    else window.localStorage.removeItem(STORAGE_KEY_SUBTYPE);
  }, [subType]);

  const setCategory = useCallback((id: TrainingCategoryId | null) => {
    setCategoryState(id);
    // Reset sub-type when the parent changes — the previous one may not apply.
    setSubTypeState(null);
  }, []);

  const setSubType = useCallback((id: string | null) => {
    setSubTypeState(id);
  }, []);

  const categoryConfig = useMemo(() => getCategoryConfig(category), [category]);

  // Auto-select the first sub-type if the category requires one and none is set.
  useEffect(() => {
    if (!categoryConfig) return;
    if (categoryConfig.subTypes && categoryConfig.subTypes.length > 0 && !subType) {
      setSubTypeState(categoryConfig.subTypes[0].id);
    }
  }, [categoryConfig, subType]);

  const config = useMemo(() => resolveCategory(categoryConfig, subType), [categoryConfig, subType]);

  const buildOutputDirCb = useCallback(
    (datasetName?: string | null) => buildOutputDir(config, datasetName),
    [config],
  );

  return {
    categories: CATEGORIES,
    presets: PRESETS,
    outputRoot: data.outputRoot,
    category,
    subType,
    config,
    defaults: config?.training ?? null,
    setCategory,
    setSubType,
    buildOutputDir: buildOutputDirCb,
  };
}
