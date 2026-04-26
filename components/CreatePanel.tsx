import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Sparkles, ChevronDown, Settings2, Trash2, Music2, Sliders, Dices, RefreshCw, Upload, Play, Pause, Loader2, Wand2 } from 'lucide-react';
import { GenerationParams, Song } from '../types';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { generateApi } from '../services/api';
import { MAIN_STYLES } from '../data/genres';
import { DIT_MODELS, getModelDisplayName, isTurboModel } from '../data/models';
import { EditableSlider } from './EditableSlider';
import { StylePresetPicker } from './StylePresetPicker';
import stylePresetsData from '../data/style-presets.json';
import type { StylePreset, StylePresetsFile } from '../types/training';

const STYLE_PRESETS: StylePreset[] = (stylePresetsData as StylePresetsFile).presets;
const DEFAULT_PRESET_ID = STYLE_PRESETS[0]?.id ?? 'custom';

interface ReferenceTrack {
  id: string;
  filename: string;
  storage_key: string;
  duration: number | null;
  file_size_bytes: number | null;
  tags: string[] | null;
  created_at: string;
  audio_url: string;
}

interface CreatePanelProps {
  onGenerate: (params: GenerationParams) => void;
  isGenerating: boolean;
  initialData?: { song: Song, timestamp: number } | null;
  createdSongs?: Song[];
  pendingAudioSelection?: { target: 'reference' | 'source'; url: string; title?: string } | null;
  onAudioSelectionApplied?: () => void;
  onNavigateToSettings?: () => void;
}

const KEY_SIGNATURES = [
  '',
  'C major', 'C minor',
  'C# major', 'C# minor',
  'Db major', 'Db minor',
  'D major', 'D minor',
  'D# major', 'D# minor',
  'Eb major', 'Eb minor',
  'E major', 'E minor',
  'F major', 'F minor',
  'F# major', 'F# minor',
  'Gb major', 'Gb minor',
  'G major', 'G minor',
  'G# major', 'G# minor',
  'Ab major', 'Ab minor',
  'A major', 'A minor',
  'A# major', 'A# minor',
  'Bb major', 'Bb minor',
  'B major', 'B minor'
];

const TIME_SIGNATURES = ['', '2', '3', '4', '6', 'N/A'];

const TRACK_NAMES = [
  'woodwinds', 'brass', 'fx', 'synth', 'strings', 'percussion',
  'keyboard', 'guitar', 'bass', 'drums', 'backing_vocals', 'vocals',
];

const VOCAL_LANGUAGE_KEYS = [
  { value: 'unknown', key: 'autoInstrumental' as const },
  { value: 'ar', key: 'vocalArabic' as const },
  { value: 'az', key: 'vocalAzerbaijani' as const },
  { value: 'bg', key: 'vocalBulgarian' as const },
  { value: 'bn', key: 'vocalBengali' as const },
  { value: 'ca', key: 'vocalCatalan' as const },
  { value: 'cs', key: 'vocalCzech' as const },
  { value: 'da', key: 'vocalDanish' as const },
  { value: 'de', key: 'vocalGerman' as const },
  { value: 'el', key: 'vocalGreek' as const },
  { value: 'en', key: 'vocalEnglish' as const },
  { value: 'es', key: 'vocalSpanish' as const },
  { value: 'fa', key: 'vocalPersian' as const },
  { value: 'fi', key: 'vocalFinnish' as const },
  { value: 'fr', key: 'vocalFrench' as const },
  { value: 'he', key: 'vocalHebrew' as const },
  { value: 'hi', key: 'vocalHindi' as const },
  { value: 'hr', key: 'vocalCroatian' as const },
  { value: 'ht', key: 'vocalHaitianCreole' as const },
  { value: 'hu', key: 'vocalHungarian' as const },
  { value: 'id', key: 'vocalIndonesian' as const },
  { value: 'is', key: 'vocalIcelandic' as const },
  { value: 'it', key: 'vocalItalian' as const },
  { value: 'ja', key: 'vocalJapanese' as const },
  { value: 'ko', key: 'vocalKorean' as const },
  { value: 'la', key: 'vocalLatin' as const },
  { value: 'lt', key: 'vocalLithuanian' as const },
  { value: 'ms', key: 'vocalMalay' as const },
  { value: 'ne', key: 'vocalNepali' as const },
  { value: 'nl', key: 'vocalDutch' as const },
  { value: 'no', key: 'vocalNorwegian' as const },
  { value: 'pa', key: 'vocalPunjabi' as const },
  { value: 'pl', key: 'vocalPolish' as const },
  { value: 'pt', key: 'vocalPortuguese' as const },
  { value: 'ro', key: 'vocalRomanian' as const },
  { value: 'ru', key: 'vocalRussian' as const },
  { value: 'sa', key: 'vocalSanskrit' as const },
  { value: 'sk', key: 'vocalSlovak' as const },
  { value: 'sr', key: 'vocalSerbian' as const },
  { value: 'sv', key: 'vocalSwedish' as const },
  { value: 'sw', key: 'vocalSwahili' as const },
  { value: 'ta', key: 'vocalTamil' as const },
  { value: 'te', key: 'vocalTelugu' as const },
  { value: 'th', key: 'vocalThai' as const },
  { value: 'tl', key: 'vocalTagalog' as const },
  { value: 'tr', key: 'vocalTurkish' as const },
  { value: 'uk', key: 'vocalUkrainian' as const },
  { value: 'ur', key: 'vocalUrdu' as const },
  { value: 'vi', key: 'vocalVietnamese' as const },
  { value: 'yue', key: 'vocalCantonese' as const },
  { value: 'zh', key: 'vocalChineseMandarin' as const },
];

export const CreatePanel: React.FC<CreatePanelProps> = ({
  onGenerate,
  isGenerating,
  initialData,
  createdSongs = [],
  pendingAudioSelection,
  onAudioSelectionApplied,
  onNavigateToSettings,
}) => {
  const { isAuthenticated, token, user } = useAuth();
  const { t } = useI18n();

  // Randomly select 6 music tags from MAIN_STYLES
  const [musicTags, setMusicTags] = useState<string[]>(() => {
    const shuffled = [...MAIN_STYLES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 6);
  });

  // Function to refresh music tags
  const refreshMusicTags = useCallback(() => {
    const shuffled = [...MAIN_STYLES].sort(() => Math.random() - 0.5);
    setMusicTags(shuffled.slice(0, 6));
  }, []);

  // Mode
  const [customMode, setCustomMode] = useState(true);

  // Style preset (Suno-style picker; defaults to 'custom' which applies no overrides).
  const [selectedPresetId, setSelectedPresetId] = useState<string>(DEFAULT_PRESET_ID);

  // Simple Mode
  const [songDescription, setSongDescription] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [simpleLoading, setSimpleLoading] = useState(false); // dice button loading
  const [simpleGenerating, setSimpleGenerating] = useState(false); // generate button loading
  const [simpleMetadataReady, setSimpleMetadataReady] = useState(false);
  const [hiddenLyrics, setHiddenLyrics] = useState('');
  const [hiddenBpm, setHiddenBpm] = useState<number | undefined>(undefined);
  const [hiddenKey, setHiddenKey] = useState('');
  const [hiddenTimeSignature, setHiddenTimeSignature] = useState('');
  const [hiddenDuration, setHiddenDuration] = useState<number | undefined>(undefined);
  const [hiddenVocalLanguage, setHiddenVocalLanguage] = useState('unknown');

  // Simple mode genre chips (random subset of MAIN_STYLES, same as custom mode)
  const [simpleGenreTags, setSimpleGenreTags] = useState<string[]>(() => {
    const shuffled = [...MAIN_STYLES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 6);
  });

  const refreshSimpleGenreTags = useCallback(() => {
    const shuffled = [...MAIN_STYLES].sort(() => Math.random() - 0.5);
    setSimpleGenreTags(shuffled.slice(0, 6));
  }, []);

  // Clear hidden metadata when user changes genres or description manually
  const clearSimpleMetadata = useCallback(() => {
    setSimpleMetadataReady(false);
    setHiddenLyrics('');
    setHiddenBpm(undefined);
    setHiddenKey('');
    setHiddenTimeSignature('');
    setHiddenDuration(undefined);
    setHiddenVocalLanguage('unknown');
  }, []);

  // Custom Mode
  const [lyrics, setLyrics] = useState('');
  const [style, setStyle] = useState('');
  const [title, setTitle] = useState('');

  // Common
  const [instrumental, setInstrumental] = useState(false);
  const [vocalLanguage, setVocalLanguage] = useState('en');
  const [vocalGender, setVocalGender] = useState<'male' | 'female' | ''>('');

  // Music Parameters
  const [bpm, setBpm] = useState(0);
  const [keyScale, setKeyScale] = useState('');
  const [timeSignature, setTimeSignature] = useState('');

  // Advanced Settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [duration, setDuration] = useState(-1);
  const [batchSize, setBatchSize] = useState(() => {
    const stored = localStorage.getItem('ace-batchSize');
    return stored ? Number(stored) : 1;
  });
  const [bulkCount, setBulkCount] = useState(() => {
    const stored = localStorage.getItem('ace-bulkCount');
    return stored ? Number(stored) : 1;
  });
  const [guidanceScale, setGuidanceScale] = useState(() => {
    const stored = localStorage.getItem('ace-guidanceScale');
    return stored ? Number(stored) : 5;
  });
  const [randomSeed, setRandomSeed] = useState(() => {
    const v = localStorage.getItem('ace-randomSeed');
    return v !== null ? v === 'true' : true;
  });
  const [seed, setSeed] = useState(() => {
    const v = localStorage.getItem('ace-seed');
    return v !== null ? Number(v) : -1;
  });
  const [thinking, setThinking] = useState(() => {
    const v = localStorage.getItem('ace-thinking');
    return v !== null ? v === 'true' : false;
  });
  const [inferenceSteps, setInferenceSteps] = useState(() => {
    const stored = localStorage.getItem('ace-inferenceSteps');
    return stored ? Number(stored) : 5;
  });
  const [shift, setShift] = useState(() => {
    const v = localStorage.getItem('ace-shift');
    return v !== null ? Number(v) : 3.0;
  });

  // LM Parameters — read from localStorage (managed by SettingsPage)

  // Expert Parameters (now in Advanced section)
  const [referenceAudioUrl, setReferenceAudioUrl] = useState('');
  const [sourceAudioUrl, setSourceAudioUrl] = useState('');
  const [referenceAudioTitle, setReferenceAudioTitle] = useState('');
  const [sourceAudioTitle, setSourceAudioTitle] = useState('');
  const [audioCodes, setAudioCodes] = useState('');
  const [repaintingStart, setRepaintingStart] = useState(0);
  const [repaintingEnd, setRepaintingEnd] = useState(-1);
  const [instruction, setInstruction] = useState('Fill the audio semantic mask based on the given conditions:');
  const [audioCoverStrength, setAudioCoverStrength] = useState(1.0);
  const [taskType, setTaskType] = useState('text2music');
  const [useAdg, setUseAdg] = useState(false);
  const [cfgIntervalStart, setCfgIntervalStart] = useState(0.0);
  const [cfgIntervalEnd, setCfgIntervalEnd] = useState(1.0);
  const [customTimesteps, setCustomTimesteps] = useState('');
  const [useCotMetas, setUseCotMetas] = useState(true);
  const [useCotCaption, setUseCotCaption] = useState(true);
  const [useCotLanguage, setUseCotLanguage] = useState(true);
  const [autogen, setAutogen] = useState(false);
  const [constrainedDecodingDebug, setConstrainedDecodingDebug] = useState(false);
  const [allowLmBatch, setAllowLmBatch] = useState(true);
  const [getScores, setGetScores] = useState(false);
  const [getLrc, setGetLrc] = useState(false);
  const [scoreScale, setScoreScale] = useState(0.5);
  const [lmBatchChunkSize, setLmBatchChunkSize] = useState(8);
  const [trackName, setTrackName] = useState('');
  const [completeTrackClasses, setCompleteTrackClasses] = useState('');
  const [isFormatCaption, setIsFormatCaption] = useState(false);
  const [maxDurationWithLm, setMaxDurationWithLm] = useState(240);
  const [maxDurationWithoutLm, setMaxDurationWithoutLm] = useState(240);

  // LoRA Parameters
  const [showLoraPanel, setShowLoraPanel] = useState(false);
  const [loraPath, setLoraPath] = useState('./lora_output/final/adapter');
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);
  const [loraLoaded, setLoraLoaded] = useState(false);
  const [loraEnabled, setLoraEnabled] = useState(true);
  const [loraScale, setLoraScale] = useState(1.0);
  const [loraError, setLoraError] = useState<string | null>(null);
  const [isLoraLoading, setIsLoraLoading] = useState(false);

  // Check LoRA status on mount
  useEffect(() => {
    if (!token) return;
    generateApi.getLoraStatus(token).then((status: any) => {
      if (status?.loaded || status?.lora_loaded || status?.active) {
        setLoraLoaded(true);
      }
    }).catch(() => {});
  }, [token]);

  // Model selection
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('ace-model') || 'acestep-v15-turbo-shift3';
  });
  const previousModelRef = useRef<string>(selectedModel);
  
  // Available models fetched from backend
  const [fetchedModels, setFetchedModels] = useState<{ name: string; is_active: boolean; is_preloaded: boolean }[]>([]);

  // Fallback model list when backend is unavailable
  const availableModels = useMemo(() => {
    if (fetchedModels.length > 0) {
      return fetchedModels.map(m => ({ id: m.name, name: m.name }));
    }
    return Object.keys(DIT_MODELS).map(id => ({ id, name: id }));
  }, [fetchedModels]);

  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const [isUploadingSource, setIsUploadingSource] = useState(false);
  const [isTranscribingReference, setIsTranscribingReference] = useState(false);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extractingCodes, setExtractingCodes] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [isFormattingStyle, setIsFormattingStyle] = useState(false);
  const [isFormattingLyrics, setIsFormattingLyrics] = useState(false);
  const [isGeneratingLyrics, setIsGeneratingLyrics] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [isGeneratingStyle, setIsGeneratingStyle] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [dragKind, setDragKind] = useState<'file' | 'audio' | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [showAudioAnalysis, setShowAudioAnalysis] = useState(false);
  const [showTrackSelection, setShowTrackSelection] = useState(false);
  const [showExpertTuning, setShowExpertTuning] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [audioModalTarget, setAudioModalTarget] = useState<'reference' | 'source'>('reference');
  const [tempAudioUrl, setTempAudioUrl] = useState('');
  const [audioTab, setAudioTab] = useState<'reference' | 'source'>('reference');
  const referenceAudioRef = useRef<HTMLAudioElement>(null);
  const sourceAudioRef = useRef<HTMLAudioElement>(null);
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [sourcePlaying, setSourcePlaying] = useState(false);
  const [referenceTime, setReferenceTime] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [referenceDuration, setReferenceDuration] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);

  // Reference tracks modal state
  const [referenceTracks, setReferenceTracks] = useState<ReferenceTrack[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [playingTrackSource, setPlayingTrackSource] = useState<'uploads' | 'created' | null>(null);
  const modalAudioRef = useRef<HTMLAudioElement>(null);
  const [modalTrackTime, setModalTrackTime] = useState(0);
  const [modalTrackDuration, setModalTrackDuration] = useState(0);
  const [libraryTab, setLibraryTab] = useState<'uploads' | 'created'>('uploads');

  const createdTrackOptions = useMemo(() => {
    return createdSongs
      .filter(song => !song.isGenerating)
      .filter(song => (user ? song.userId === user.id : true))
      .filter(song => Boolean(song.audioUrl))
      .map(song => ({
        id: song.id,
        title: song.title || 'Untitled',
        audio_url: song.audioUrl!,
        duration: song.duration,
      }));
  }, [createdSongs, user]);

  const getAudioLabel = (url: string) => {
    try {
      const parsed = new URL(url);
      const name = decodeURIComponent(parsed.pathname.split('/').pop() || parsed.hostname);
      return name.replace(/\.[^/.]+$/, '') || name;
    } catch {
      const parts = url.split('/');
      const name = decodeURIComponent(parts[parts.length - 1] || url);
      return name.replace(/\.[^/.]+$/, '') || name;
    }
  };

  // Resize Logic
  const [lyricsHeight, setLyricsHeight] = useState(() => {
    const saved = localStorage.getItem('acestep_lyrics_height');
    return saved ? parseInt(saved, 10) : 144; // Default h-36 is 144px (9rem * 16)
  });
  const [isResizing, setIsResizing] = useState(false);
  const lyricsRef = useRef<HTMLDivElement>(null);


  // Auto-unload LoRA when model changes
  useEffect(() => {
    if (previousModelRef.current !== selectedModel && loraLoaded) {
      void handleLoraUnload();
    }
    previousModelRef.current = selectedModel;
  }, [selectedModel, loraLoaded]);

  // Auto-disable thinking and ADG when LoRA is loaded
  useEffect(() => {
    if (loraLoaded) {
      if (thinking) setThinking(false);
      if (useAdg) setUseAdg(false);
    }
  }, [loraLoaded]);

  // LoRA API handlers
  // Fetch available LoRA checkpoints when panel opens
  useEffect(() => {
    if (!showLoraPanel || !token) return;
    fetch('/api/training/lora-checkpoints', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        const paths = data.checkpoints || [];
        setAvailableLoras(paths);
      })
      .catch(() => {});
  }, [showLoraPanel, token]);

  const handleLoraToggle = async () => {
    if (!token) {
      setLoraError('Please sign in to use LoRA');
      return;
    }
    if (!loraPath.trim()) {
      setLoraError('Please enter a LoRA path');
      return;
    }

    setIsLoraLoading(true);
    setLoraError(null);

    try {
      if (loraLoaded) {
        await handleLoraUnload();
      } else {
        try {
          const result = await generateApi.loadLora({ lora_path: loraPath }, token);
          setLoraLoaded(true);
          console.log('LoRA loaded:', result?.message);
        } catch (loadErr: any) {
          // If adapter already in use, unload first then retry
          if (loadErr?.message?.includes('already in use')) {
            await handleLoraUnload();
            const result = await generateApi.loadLora({ lora_path: loraPath }, token);
            setLoraLoaded(true);
            console.log('LoRA reloaded after unload:', result?.message);
          } else {
            throw loadErr;
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'LoRA operation failed';
      setLoraError(message);
      console.error('LoRA error:', err);
    } finally {
      setIsLoraLoading(false);
    }
  };

  const handleLoraUnload = async () => {
    if (!token) return;
    
    setIsLoraLoading(true);
    setLoraError(null);

    try {
      const result = await generateApi.unloadLora(token);
      setLoraLoaded(false);
      console.log('LoRA unloaded:', result?.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unload LoRA';
      setLoraError(message);
      console.error('Unload error:', err);
    } finally {
      setIsLoraLoading(false);
    }
  };

  const handleLoraScaleChange = async (newScale: number) => {
    setLoraScale(newScale);

    if (!token || !loraLoaded) return;

    try {
      await generateApi.setLoraScale({ scale: newScale }, token);
    } catch (err) {
      console.error('Failed to set LoRA scale:', err);
    }
  };

  const handleLoraEnabledToggle = async () => {
    if (!token || !loraLoaded) return;
    const newEnabled = !loraEnabled;
    setLoraEnabled(newEnabled);
    try {
      await generateApi.toggleLora({ enabled: newEnabled }, token);
    } catch (err) {
      console.error('Failed to toggle LoRA:', err);
      setLoraEnabled(!newEnabled); // revert on error
    }
  };

  // Load generation parameters from JSON file
  const handleLoadParamsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.lyrics !== undefined) setLyrics(data.lyrics);
        if (data.style !== undefined) setStyle(data.style);
        if (data.title !== undefined) setTitle(data.title);
        if (data.caption !== undefined) setStyle(data.caption);
        if (data.instrumental !== undefined) setInstrumental(data.instrumental);
        if (data.vocal_language !== undefined) setVocalLanguage(data.vocal_language);
        if (data.bpm !== undefined) setBpm(data.bpm);
        if (data.key_scale !== undefined) setKeyScale(data.key_scale);
        if (data.time_signature !== undefined) setTimeSignature(data.time_signature);
        if (data.duration !== undefined) setDuration(data.duration);
        if (data.inference_steps !== undefined) setInferenceSteps(data.inference_steps);
        if (data.guidance_scale !== undefined) setGuidanceScale(data.guidance_scale);
        if (data.audio_format !== undefined) localStorage.setItem('ace-audioFormat', data.audio_format);
        if (data.infer_method !== undefined) localStorage.setItem('ace-inferMethod', data.infer_method);
        if (data.seed !== undefined) { setSeed(data.seed); setRandomSeed(false); localStorage.setItem('ace-seed', String(data.seed)); localStorage.setItem('ace-randomSeed', 'false'); }
        if (data.shift !== undefined) { setShift(data.shift); localStorage.setItem('ace-shift', String(data.shift)); }
        if (data.lm_temperature !== undefined) localStorage.setItem('ace-lmTemperature', String(data.lm_temperature));
        if (data.lm_cfg_scale !== undefined) localStorage.setItem('ace-lmCfgScale', String(data.lm_cfg_scale));
        if (data.lm_top_k !== undefined) localStorage.setItem('ace-lmTopK', String(data.lm_top_k));
        if (data.lm_top_p !== undefined) localStorage.setItem('ace-lmTopP', String(data.lm_top_p));
        if (data.lm_negative_prompt !== undefined) localStorage.setItem('ace-lmNegativePrompt', data.lm_negative_prompt);
        if (data.task_type !== undefined) setTaskType(data.task_type);
        if (data.audio_codes !== undefined) setAudioCodes(data.audio_codes);
        if (data.repainting_start !== undefined) setRepaintingStart(data.repainting_start);
        if (data.repainting_end !== undefined) setRepaintingEnd(data.repainting_end);
        if (data.instruction !== undefined) setInstruction(data.instruction);
        if (data.audio_cover_strength !== undefined) setAudioCoverStrength(data.audio_cover_strength);
      } catch {
        console.error('Failed to parse parameters JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset so same file can be reloaded
  };

  // Reuse Effect - must be after all state declarations
  useEffect(() => {
    if (initialData) {
      setCustomMode(true);
      setLyrics(initialData.song.lyrics);
      setStyle(initialData.song.style);
      setTitle(initialData.song.title);
      setInstrumental(initialData.song.lyrics.length === 0);
    }
  }, [initialData]);

  useEffect(() => {
    if (!pendingAudioSelection) return;
    applyAudioTargetUrl(
      pendingAudioSelection.target,
      pendingAudioSelection.url,
      pendingAudioSelection.title
    );
    onAudioSelectionApplied?.();
  }, [pendingAudioSelection, onAudioSelectionApplied]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      // Calculate new height based on mouse position relative to the lyrics container top
      // We can't easily get the container top here without a ref to it, 
      // but we can use dy (delta y) from the previous position if we tracked it,
      // OR simpler: just update based on movement if we track the start.
      //
      // Better approach for absolute sizing: 
      // 1. Get the bounding rect of the textarea wrapper on mount/resize start? 
      //    We can just rely on the fact that we are dragging the bottom.
      //    So new height = currentMouseY - topOfElement.

      if (lyricsRef.current) {
        const rect = lyricsRef.current.getBoundingClientRect();
        const newHeight = e.clientY - rect.top;
        // detailed limits: min 96px (h-24), max 600px
        if (newHeight > 96 && newHeight < 600) {
          setLyricsHeight(newHeight);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
      // Save height to localStorage
      localStorage.setItem('acestep_lyrics_height', String(lyricsHeight));
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none'; // Prevent text selection while dragging
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isResizing]);

  const refreshModels = useCallback(async () => {
    try {
      const modelsRes = await fetch('/api/generate/models');
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        const models = data.models || [];
        if (models.length > 0) {
          setFetchedModels(models);
          // Always sync to the backend's active model
          const active = models.find((m: any) => m.is_active);
          if (active) {
            setSelectedModel(active.name);
            localStorage.setItem('ace-model', active.name);
          }
        }
      }
    } catch {
      // ignore - will use fallback model list
    }
  }, []);

  useEffect(() => {
    const loadModelsAndLimits = async () => {
      await refreshModels();

      // Fetch limits
      try {
        const response = await fetch('/api/generate/limits');
        if (!response.ok) return;
        const data = await response.json();
        if (typeof data.max_duration_with_lm === 'number') {
          setMaxDurationWithLm(data.max_duration_with_lm);
        }
        if (typeof data.max_duration_without_lm === 'number') {
          setMaxDurationWithoutLm(data.max_duration_without_lm);
        }
      } catch {
        // ignore limits fetch failures
      }
    };

    loadModelsAndLimits();
  }, []);

  // Re-fetch models after generation completes to update active model
  const prevIsGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (prevIsGeneratingRef.current && !isGenerating) {
      void refreshModels();
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating, refreshModels]);

  const activeMaxDuration = thinking ? maxDurationWithLm : maxDurationWithoutLm;

  useEffect(() => {
    if (duration > activeMaxDuration) {
      setDuration(activeMaxDuration);
    }
  }, [duration, activeMaxDuration]);

  useEffect(() => {
    const getDragKind = (e: DragEvent): 'file' | 'audio' | null => {
      if (!e.dataTransfer) return null;
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('Files')) return 'file';
      if (types.includes('application/x-ace-audio')) return 'audio';
      return null;
    };

    const handleDragEnter = (e: DragEvent) => {
      const kind = getDragKind(e);
      if (!kind) return;
      dragDepthRef.current += 1;
      setIsDraggingFile(true);
      setDragKind(kind);
      e.preventDefault();
    };

    const handleDragOver = (e: DragEvent) => {
      const kind = getDragKind(e);
      if (!kind) return;
      setDragKind(kind);
      e.preventDefault();
    };

    const handleDragLeave = (e: DragEvent) => {
      const kind = getDragKind(e);
      if (!kind) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingFile(false);
        setDragKind(null);
      }
    };

    const handleDrop = (e: DragEvent) => {
      const kind = getDragKind(e);
      if (!kind) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFile(false);
      setDragKind(null);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, target: 'reference' | 'source') => {
    const file = e.target.files?.[0];
    if (file) {
      void uploadReferenceTrack(file, target);
    }
    e.target.value = '';
  };

  // Format handler - uses LLM to enhance style/lyrics and auto-fill parameters
  const handleFormat = async (target: 'style' | 'lyrics') => {
    if (!token || !style.trim()) return;
    if (target === 'style') {
      setIsFormattingStyle(true);
    } else {
      setIsFormattingLyrics(true);
    }
    try {
      const lsLmTemperature = Number(localStorage.getItem('ace-lmTemperature') ?? '0.95');
      const lsLmTopK = Number(localStorage.getItem('ace-lmTopK') ?? '60');
      const lsLmTopP = Number(localStorage.getItem('ace-lmTopP') ?? '0.95');
      const lsLmModel = localStorage.getItem('ace-lmModel') || 'acestep-5Hz-lm-0.6B';
      const lsLmBackend = localStorage.getItem('ace-lmBackend') || 'pt';
      const result = await generateApi.formatInput({
        caption: style,
        lyrics: lyrics,
        bpm: bpm > 0 ? bpm : undefined,
        duration: duration > 0 ? duration : undefined,
        keyScale: keyScale || undefined,
        timeSignature: timeSignature || undefined,
        temperature: lsLmTemperature,
        topK: lsLmTopK > 0 ? lsLmTopK : undefined,
        topP: lsLmTopP,
        lmModel: lsLmModel,
        lmBackend: lsLmBackend,
      }, token);

      if (result.caption || result.lyrics || result.bpm || result.duration) {
        // Update fields with LLM-generated values
        if (target === 'style' && result.caption) setStyle(result.caption);
        if (target === 'lyrics' && result.lyrics) setLyrics(result.lyrics);
        if (result.bpm && result.bpm > 0) setBpm(result.bpm);
        if (result.duration && result.duration > 0) setDuration(result.duration);
        if (result.key_scale) setKeyScale(result.key_scale);
        if (result.time_signature) {
          const ts = String(result.time_signature);
          setTimeSignature(ts.includes('/') ? ts : `${ts}/4`);
        }
        if (result.vocal_language) setVocalLanguage(result.vocal_language);
        if (target === 'style') setIsFormatCaption(true);
      } else {
        console.error('Format failed:', result.error || result.status_message);
        alert(result.error || result.status_message || 'Format failed. Make sure the LLM is initialized.');
      }
    } catch (err) {
      console.error('Format error:', err);
      alert('Format failed. The LLM may not be available.');
    } finally {
      if (target === 'style') {
        setIsFormattingStyle(false);
      } else {
        setIsFormattingLyrics(false);
      }
    }
  };

  // --- Lyrics LLM generation ---
  const handleGenerateLyrics = async () => {
    if (!token) return;
    setIsGeneratingLyrics(true);
    try {
      const lyricsModel = localStorage.getItem('ace-lyricsModel') || '';
      const langEntry = VOCAL_LANGUAGE_KEYS.find(l => l.value === vocalLanguage);
      const langLabel = langEntry ? langEntry.key.replace('vocal', '') : 'English';
      const res = await fetch('/api/lyrics/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          genre: style || '',
          language: langLabel,
          topic: songDescription || '',
          mood: '',
          structure: '',
          modelId: lyricsModel || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        alert(err.error || 'Lyrics generation failed');
        return;
      }
      const data = await res.json();
      if (data.lyrics) {
        setLyrics(data.lyrics);
      }
    } catch (err) {
      console.error('Lyrics generation error:', err);
      alert('Lyrics generation failed. Make sure a lyrics model is downloaded in Settings.');
    } finally {
      setIsGeneratingLyrics(false);
    }
  };

  const handleAutoFillAll = async () => {
    if (!token) return;
    const desc = songDescription || style || '';
    if (!desc.trim()) {
      alert('Please enter a song description or style first.');
      return;
    }
    setIsAutoFilling(true);
    try {
      const lyricsModel = localStorage.getItem('ace-lyricsModel') || '';
      const res = await fetch('/api/lyrics/generate-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          description: desc,
          modelId: lyricsModel || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        alert(err.error || 'Auto-fill failed');
        return;
      }
      const data = await res.json();
      if (data.style) setStyle(data.style);
      if (data.lyrics) setLyrics(data.lyrics);
      if (data.bpm && Number(data.bpm) > 0) setBpm(Number(data.bpm));
      if (data.key) setKeyScale(data.key);
      if (data.timeSignature) setTimeSignature(String(data.timeSignature));
      if (data.language) setVocalLanguage(data.language);
      if (data.instrumental !== undefined) setInstrumental(Boolean(data.instrumental));
    } catch (err) {
      console.error('Auto-fill error:', err);
      alert('Auto-fill failed. Make sure a lyrics model is downloaded in Settings.');
    } finally {
      setIsAutoFilling(false);
    }
  };

  const handleGenerateStyle = async () => {
    if (!token) return;
    setIsGeneratingStyle(true);
    try {
      const res = await fetch('/api/lyrics/generate-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ genre: style || '' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Style generation failed' }));
        alert(err.error || 'Style generation failed');
        return;
      }
      const data = await res.json();
      if (data.style) {
        setStyle(data.style);
      }
    } catch (err) {
      console.error('Style generation error:', err);
      alert('Style generation failed. Make sure a lyrics model is available.');
    } finally {
      setIsGeneratingStyle(false);
    }
  };

  const openAudioModal = (target: 'reference' | 'source', tab: 'uploads' | 'created' = 'uploads') => {
    setAudioModalTarget(target);
    setTempAudioUrl('');
    setLibraryTab(tab);
    setShowAudioModal(true);
    void fetchReferenceTracks();
  };

  const fetchReferenceTracks = useCallback(async () => {
    if (!token) return;
    setIsLoadingTracks(true);
    try {
      const response = await fetch('/api/reference-tracks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReferenceTracks(data.tracks || []);
      }
    } catch (err) {
      console.error('Failed to fetch reference tracks:', err);
    } finally {
      setIsLoadingTracks(false);
    }
  }, [token]);

  const uploadReferenceTrack = async (file: File, target?: 'reference' | 'source') => {
    if (!token) {
      setUploadError('Please sign in to upload audio.');
      return;
    }
    setUploadError(null);
    setIsUploadingReference(true);
    try {
      const formData = new FormData();
      formData.append('audio', file);

      const response = await fetch('/api/reference-tracks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }

      const data = await response.json();
      setReferenceTracks(prev => [data.track, ...prev]);

      // Also set as current reference/source
      const selectedTarget = target ?? audioModalTarget;
      applyAudioTargetUrl(selectedTarget, data.track.audio_url, data.track.filename);
      if (data.whisper_available && data.track?.id) {
        void transcribeReferenceTrack(data.track.id).then(() => undefined);
      } else {
        setShowAudioModal(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(message);
    } finally {
      setIsUploadingReference(false);
    }
  };

  const transcribeReferenceTrack = async (trackId: string) => {
    if (!token) return;
    setIsTranscribingReference(true);
    const controller = new AbortController();
    transcribeAbortRef.current = controller;
    try {
      const response = await fetch(`/api/reference-tracks/${trackId}/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error('Failed to transcribe');
      }
      const data = await response.json();
      if (data.lyrics) {
        setLyrics(prev => prev || data.lyrics);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Transcription failed:', err);
    } finally {
      if (transcribeAbortRef.current === controller) {
        transcribeAbortRef.current = null;
      }
      setIsTranscribingReference(false);
    }
  };

  const cancelTranscription = () => {
    if (transcribeAbortRef.current) {
      transcribeAbortRef.current.abort();
      transcribeAbortRef.current = null;
    }
    setIsTranscribingReference(false);
  };

  const deleteReferenceTrack = async (trackId: string) => {
    if (!token) return;
    try {
      const response = await fetch(`/api/reference-tracks/${trackId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setReferenceTracks(prev => prev.filter(t => t.id !== trackId));
        if (playingTrackId === trackId && playingTrackSource === 'uploads') {
          setPlayingTrackId(null);
          setPlayingTrackSource(null);
          if (modalAudioRef.current) {
            modalAudioRef.current.pause();
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete track:', err);
    }
  };

  const useReferenceTrack = (track: { audio_url: string; title?: string }) => {
    applyAudioTargetUrl(audioModalTarget, track.audio_url, track.title);
    setShowAudioModal(false);
    setPlayingTrackId(null);
    setPlayingTrackSource(null);
  };

  const toggleModalTrack = (track: { id: string; audio_url: string; source: 'uploads' | 'created' }) => {
    if (playingTrackId === track.id) {
      if (modalAudioRef.current) {
        modalAudioRef.current.pause();
      }
      setPlayingTrackId(null);
      setPlayingTrackSource(null);
    } else {
      setPlayingTrackId(track.id);
      setPlayingTrackSource(track.source);
      if (modalAudioRef.current) {
        modalAudioRef.current.src = track.audio_url;
        modalAudioRef.current.play().catch(() => undefined);
      }
    }
  };

  const applyAudioUrl = () => {
    if (!tempAudioUrl.trim()) return;
    applyAudioTargetUrl(audioModalTarget, tempAudioUrl.trim());
    setShowAudioModal(false);
    setTempAudioUrl('');
  };

  const applyAudioTargetUrl = (target: 'reference' | 'source', url: string, title?: string) => {
    const derivedTitle = title ? title.replace(/\.[^/.]+$/, '') : getAudioLabel(url);
    if (target === 'reference') {
      setReferenceAudioUrl(url);
      setReferenceAudioTitle(derivedTitle);
      setReferenceTime(0);
      setReferenceDuration(0);
    } else {
      setSourceAudioUrl(url);
      setSourceAudioTitle(derivedTitle);
      setSourceTime(0);
      setSourceDuration(0);
      if (taskType === 'text2music') {
        setTaskType('cover');
      }
    }
  };

  const formatTime = (time: number) => {
    if (!Number.isFinite(time) || time <= 0) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const toggleAudio = (target: 'reference' | 'source') => {
    const audio = target === 'reference' ? referenceAudioRef.current : sourceAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: 'reference' | 'source') => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void uploadReferenceTrack(file, target);
      return;
    }
    const payload = e.dataTransfer.getData('application/x-ace-audio');
    if (payload) {
      try {
        const data = JSON.parse(payload);
        if (data?.url) {
          applyAudioTargetUrl(target, data.url, data.title);
        }
      } catch {
        // ignore
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleWorkspaceDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.files?.length || e.dataTransfer.types.includes('application/x-ace-audio')) {
      handleDrop(e, audioTab);
    }
  };

  const handleWorkspaceDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-ace-audio')) {
      e.preventDefault();
    }
  };

  // Simple mode: dice button — calls /api/generate/simple to get metadata + lyrics
  const handleSimpleDice = async () => {
    if (!token) return;

    setSimpleLoading(true);
    try {
      const result = await generateApi.simpleGenerate({
        description: songDescription || '',
        instrumental,
      }, token);

      // Show caption in the description textarea
      if (result.caption) {
        setSongDescription(result.caption);
      }
      // Store hidden lyrics and language
      setHiddenLyrics(result.lyrics || '');
      setHiddenVocalLanguage(result.language || 'unknown');
      setSimpleMetadataReady(true);
    } catch (err) {
      console.error('Simple dice error:', err);
      alert('Failed to prepare song idea. Please try again.');
    } finally {
      setSimpleLoading(false);
    }
  };

  // Simple mode: fire generation with metadata
  const fireSimpleGenerate = (meta: {
    caption: string;
    lyrics: string;
    bpm?: number;
    key?: string;
    timeSignature?: string;
    duration?: number;
    vocal_language?: string;
  }) => {
    const lsAudioFormat = (localStorage.getItem('ace-audioFormat') || 'mp3') as 'mp3' | 'flac';
    const lsInferMethod = (localStorage.getItem('ace-inferMethod') || 'ode') as 'ode' | 'sde';
    const lsLmBackend = (localStorage.getItem('ace-lmBackend') || 'pt') as 'pt' | 'vllm';
    const lsLmModel = localStorage.getItem('ace-lmModel') || 'acestep-5Hz-lm-0.6B';
    const lsLmTemperature = Number(localStorage.getItem('ace-lmTemperature') ?? '0.95');
    const lsLmCfgScale = Number(localStorage.getItem('ace-lmCfgScale') ?? '1.0');
    const lsLmTopK = Number(localStorage.getItem('ace-lmTopK') ?? '60');
    const lsLmTopP = Number(localStorage.getItem('ace-lmTopP') ?? '0.95');
    const lsLmNegativePrompt = localStorage.getItem('ace-lmNegativePrompt') || '';
    const lsInferenceSteps = Number(localStorage.getItem('ace-inferenceSteps') ?? '5');
    const lsGuidanceScale = Number(localStorage.getItem('ace-guidanceScale') ?? '5');
    const lsShift = Number(localStorage.getItem('ace-shift') ?? '3.0');

    onGenerate({
      customMode: true,
      lyrics: meta.lyrics || (instrumental ? '[Instrumental]' : ''),
      style: meta.caption || songDescription,
      title: '',
      ditModel: selectedModel,
      instrumental,
      vocalLanguage: meta.vocal_language || 'unknown',
      bpm: meta.bpm || 0,
      keyScale: meta.key || '',
      timeSignature: meta.timeSignature || '',
      duration: meta.duration || -1,
      inferenceSteps: lsInferenceSteps,
      guidanceScale: lsGuidanceScale,
      batchSize: 1,
      randomSeed: true,
      seed: -1,
      thinking: false,
      enhance: false,
      audioFormat: lsAudioFormat,
      inferMethod: lsInferMethod,
      lmBackend: lsLmBackend,
      lmModel: lsLmModel,
      shift: lsShift,
      lmTemperature: lsLmTemperature,
      lmCfgScale: lsLmCfgScale,
      lmTopK: lsLmTopK,
      lmTopP: lsLmTopP,
      lmNegativePrompt: lsLmNegativePrompt,
      prompt: meta.lyrics || '',
      isFormatCaption: true,
      taskType: 'text2music',
      useCotMetas: true,
      useCotCaption: true,
      useCotLanguage: true,
      autogen: false,
      useAdg: false,
      cfgIntervalStart: 0.0,
      cfgIntervalEnd: 1.0,
      allowLmBatch: true,
      repaintingStart: 0,
      repaintingEnd: -1,
      instruction: 'Fill the audio semantic mask based on the given conditions:',
      audioCoverStrength: 1.0,
      constrainedDecodingDebug: false,
      getScores: false,
      getLrc: false,
      scoreScale: 0.5,
      lmBatchChunkSize: 8,
    });
  };

  // Simple mode: generate button handler
  const handleSimpleGenerate = async () => {
    if (!token || !songDescription.trim()) return;

    if (simpleMetadataReady) {
      // Metadata prepared via dice button — use it
      fireSimpleGenerate({
        caption: songDescription,
        lyrics: hiddenLyrics,
        bpm: hiddenBpm,
        key: hiddenKey,
        timeSignature: hiddenTimeSignature,
        duration: hiddenDuration,
        vocal_language: hiddenVocalLanguage,
      });
    } else {
      // No dice used — just send the description directly, ACE-Step handles it
      fireSimpleGenerate({
        caption: songDescription,
        lyrics: instrumental ? '[Instrumental]' : '',
        vocal_language: 'unknown',
      });
    }
  };

  // Apply a style preset to the relevant CreatePanel state. Tags are merged
  // into the `style` field (replacing it with the preset tags), and advanced
  // settings update via localStorage to match how the rest of the panel
  // reads them. The "Custom (no preset)" entry has `clear: true` and is a
  // no-op — the user keeps whatever they had.
  const applyStylePreset = useCallback((preset: StylePreset) => {
    setSelectedPresetId(preset.id);
    if (preset.clear) return;

    if (preset.tags !== undefined) {
      setStyle(preset.tags);
    }
    if (preset.cfgScale !== undefined) {
      setGuidanceScale(preset.cfgScale);
      localStorage.setItem('ace-guidanceScale', String(preset.cfgScale));
    }
    if (preset.inferenceSteps !== undefined) {
      setInferenceSteps(preset.inferenceSteps);
      localStorage.setItem('ace-inferenceSteps', String(preset.inferenceSteps));
    }
    if (preset.scheduler !== undefined) {
      // The Generate panel reads inferMethod from localStorage at submit time
      // (see fireSimpleGenerate / handleGenerate). Mirror it there.
      localStorage.setItem('ace-inferMethod', preset.scheduler);
    }
    if (preset.duration !== undefined) {
      setDuration(preset.duration);
    }
    // The remaining preset fields (cfgType, omegaScale, guidanceInterval,
    // guidanceScaleText, guidanceScaleLyric, useErgTag, useErgDiffusion) are
    // stored in localStorage so existing code paths pick them up. The keys
    // mirror the existing `ace-*` naming convention used by SettingsPage.
    if (preset.cfgType !== undefined) localStorage.setItem('ace-cfgType', preset.cfgType);
    if (preset.omegaScale !== undefined) localStorage.setItem('ace-omegaScale', String(preset.omegaScale));
    if (preset.guidanceInterval !== undefined) localStorage.setItem('ace-guidanceInterval', String(preset.guidanceInterval));
    if (preset.guidanceScaleText !== undefined) localStorage.setItem('ace-guidanceScaleText', String(preset.guidanceScaleText));
    if (preset.guidanceScaleLyric !== undefined) localStorage.setItem('ace-guidanceScaleLyric', String(preset.guidanceScaleLyric));
    if (preset.useErgTag !== undefined) localStorage.setItem('ace-useErgTag', String(preset.useErgTag));
    if (preset.useErgDiffusion !== undefined) localStorage.setItem('ace-useErgDiffusion', String(preset.useErgDiffusion));
  }, []);

  const handleGenerate = () => {
    // Custom mode: auto-detect instrumental from lyrics. Simple mode: use toggle.
    const autoInstrumental = customMode
      ? (lyrics.trim() === '' || lyrics.trim() === '[Instrumental]')
      : instrumental;

    const styleWithGender = (() => {
      if (!vocalGender) return style;
      const genderHint = vocalGender === 'male' ? 'Male vocals' : 'Female vocals';
      const trimmed = style.trim();
      return trimmed ? `${trimmed}\n${genderHint}` : genderHint;
    })();

    // Read settings from localStorage (managed by SettingsPage)
    const lsAudioFormat = (localStorage.getItem('ace-audioFormat') || 'mp3') as 'mp3' | 'flac';
    const lsInferMethod = (localStorage.getItem('ace-inferMethod') || 'ode') as 'ode' | 'sde';
    const lsLmBackend = (localStorage.getItem('ace-lmBackend') || 'pt') as 'pt' | 'vllm';
    const lsLmModel = localStorage.getItem('ace-lmModel') || 'acestep-5Hz-lm-0.6B';
    const lsLmTemperature = Number(localStorage.getItem('ace-lmTemperature') ?? '0.95');
    const lsLmCfgScale = Number(localStorage.getItem('ace-lmCfgScale') ?? '1.0');
    const lsLmTopK = Number(localStorage.getItem('ace-lmTopK') ?? '60');
    const lsLmTopP = Number(localStorage.getItem('ace-lmTopP') ?? '0.95');
    const lsLmNegativePrompt = localStorage.getItem('ace-lmNegativePrompt') || '';

    // Bulk generation: loop bulkCount times
    for (let i = 0; i < bulkCount; i++) {
      // Seed handling: first job uses user's seed, rest get random seeds
      let jobSeed = -1;
      if (!randomSeed && i === 0) {
        jobSeed = seed;
      } else if (!randomSeed && i > 0) {
        // Subsequent jobs get random seeds for variety
        jobSeed = Math.floor(Math.random() * 4294967295);
      }

      onGenerate({
        customMode,
        songDescription: customMode ? undefined : songDescription,
        prompt: lyrics,
        lyrics,
        style: styleWithGender,
        title: bulkCount > 1 ? `${title} (${i + 1})` : title,
        ditModel: selectedModel,
        instrumental: autoInstrumental,
        vocalLanguage,
        bpm,
        keyScale,
        timeSignature,
        duration,
        inferenceSteps,
        guidanceScale,
        batchSize,
        randomSeed: randomSeed || i > 0, // Force random for subsequent bulk jobs
        seed: jobSeed,
        thinking,
        enhance: false,
        audioFormat: lsAudioFormat,
        inferMethod: lsInferMethod,
        lmBackend: lsLmBackend,
        lmModel: lsLmModel,
        shift,
        lmTemperature: lsLmTemperature,
        lmCfgScale: lsLmCfgScale,
        lmTopK: lsLmTopK,
        lmTopP: lsLmTopP,
        lmNegativePrompt: lsLmNegativePrompt,
        referenceAudioUrl: referenceAudioUrl.trim() || undefined,
        sourceAudioUrl: sourceAudioUrl.trim() || undefined,
        referenceAudioTitle: referenceAudioTitle.trim() || undefined,
        sourceAudioTitle: sourceAudioTitle.trim() || undefined,
        audioCodes: audioCodes.trim() || undefined,
        repaintingStart,
        repaintingEnd,
        instruction,
        audioCoverStrength,
        taskType,
        useAdg,
        cfgIntervalStart,
        cfgIntervalEnd,
        customTimesteps: customTimesteps.trim() || undefined,
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
        trackName: trackName.trim() || undefined,
        completeTrackClasses: (() => {
          const parsed = completeTrackClasses
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          return parsed.length ? parsed : undefined;
        })(),
        isFormatCaption,
        loraLoaded,
      });
    }

    // Reset bulk count after generation
    if (bulkCount > 1) {
      setBulkCount(1);
    }
  };

  return (
    <div
      className="relative flex flex-col h-full bg-zinc-50 dark:bg-suno-panel w-full overflow-y-auto custom-scrollbar transition-colors duration-300"
      onDrop={handleWorkspaceDrop}
      onDragOver={handleWorkspaceDragOver}
    >
      {isDraggingFile && (
        <div className="absolute inset-0 z-[90] pointer-events-none">
          <div className="absolute inset-0 bg-white/70 dark:bg-black/50 backdrop-blur-sm" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 px-6 py-5 shadow-xl">
              {dragKind !== 'audio' && (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center shadow-lg">
                  <Upload size={22} />
                </div>
              )}
              <div className="text-sm font-semibold text-zinc-900 dark:text-white">
                {dragKind === 'audio' ? t('dropToUseAudio') : t('dropToUpload')}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {dragKind === 'audio'
                  ? (audioTab === 'reference' ? t('usingAsReference') : t('usingAsCover'))
                  : (audioTab === 'reference' ? t('uploadingAsReference') : t('uploadingAsCover'))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="p-4 pt-14 md:pt-4 pb-24 lg:pb-32 space-y-5">
        <input
          ref={referenceInputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => handleFileSelect(e, 'reference')}
          className="hidden"
        />
        <input
          ref={sourceInputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => handleFileSelect(e, 'source')}
          className="hidden"
        />
        <audio
          ref={referenceAudioRef}
          src={referenceAudioUrl || undefined}
          onPlay={() => setReferencePlaying(true)}
          onPause={() => setReferencePlaying(false)}
          onEnded={() => setReferencePlaying(false)}
          onTimeUpdate={(e) => setReferenceTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setReferenceDuration(e.currentTarget.duration || 0)}
        />
        <audio
          ref={sourceAudioRef}
          src={sourceAudioUrl || undefined}
          onPlay={() => setSourcePlaying(true)}
          onPause={() => setSourcePlaying(false)}
          onEnded={() => setSourcePlaying(false)}
          onTimeUpdate={(e) => setSourceTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setSourceDuration(e.currentTarget.duration || 0)}
        />

        {/* Header - Mode Toggle & Model Selection */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">ACE-Step v1.5</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode Toggle */}
            <div className="flex items-center bg-zinc-200 dark:bg-black/40 rounded-lg p-1 border border-zinc-300 dark:border-white/5">
              <button
                onClick={() => setCustomMode(false)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${!customMode ? 'bg-white dark:bg-zinc-800 text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
              >
                {t('simple')}
              </button>
              <button
                onClick={() => setCustomMode(true)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${customMode ? 'bg-white dark:bg-zinc-800 text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
              >
                {t('custom')}
              </button>
            </div>

            {/* Model Label — click to go to Settings */}
            <button
              onClick={() => onNavigateToSettings?.()}
              className="bg-zinc-200 dark:bg-black/40 border border-zinc-300 dark:border-white/5 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-900 dark:text-white hover:bg-zinc-300 dark:hover:bg-black/50 transition-colors flex items-center gap-1"
              title="Change model in Settings"
            >
              {getModelDisplayName(selectedModel)}
              <Settings2 size={10} className="text-zinc-600 dark:text-zinc-400" />
            </button>
          </div>
        </div>

        {/* STYLE PRESET PICKER (Suno-style) — applies vetted defaults to the
            existing form fields. Default selection is "Custom (no preset)". */}
        <StylePresetPicker
          presets={STYLE_PRESETS}
          selectedId={selectedPresetId}
          onSelect={applyStylePreset}
        />

        {/* SIMPLE MODE */}
        {!customMode && (
          <div className="space-y-4">
            {/* Describe your song — one card with textarea, genres, and dice */}
            <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden transition-colors group focus-within:border-zinc-400 dark:focus-within:border-white/20">
              <div className="px-3 py-2.5 flex items-center justify-between border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/5">
                <div>
                  <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{t('describeYourSong')}</span>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">Pick genres, describe, then generate</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded transition-colors text-zinc-500 hover:text-black dark:hover:text-white"
                    title={t('refreshGenres')}
                    onClick={refreshSimpleGenreTags}
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
                    onClick={() => setSongDescription('')}
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={handleSimpleDice}
                    disabled={simpleLoading}
                    title="Generate lyrics & metadata from description"
                    className={`p-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      simpleLoading
                        ? 'text-pink-500'
                        : simpleMetadataReady
                          ? 'text-green-500 hover:text-green-400 hover:bg-zinc-200 dark:hover:bg-white/10'
                          : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10'
                    }`}
                  >
                    {simpleLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  </button>
                </div>
              </div>
              <textarea
                value={songDescription}
                onChange={(e) => { setSongDescription(e.target.value); clearSimpleMetadata(); }}
                placeholder="Describe your song... e.g., Epic anthem about breaking free, with soaring vocals"
                className="w-full h-24 bg-transparent p-3 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none resize-none"
              />
              <div className="px-3 pb-3">
                <div className="flex flex-wrap gap-2">
                  {simpleGenreTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => { setSongDescription(prev => prev ? `${prev}, ${tag}` : tag); clearSimpleMetadata(); }}
                      className="text-[10px] font-medium bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white px-2.5 py-1 rounded-full transition-colors border border-zinc-200 dark:border-white/5"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                {simpleMetadataReady && (
                  <p className="text-[10px] font-medium text-green-500 dark:text-green-400 mt-2">Ready — click Generate</p>
                )}
              </div>
            </div>

            {/* Instrumental Toggle */}
            <div className="flex items-center justify-between px-1 py-1">
              <div className="flex items-center gap-2">
                <Music2 size={14} className="text-zinc-500" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Instrumental</span>
              </div>
              <button
                onClick={() => { setInstrumental(!instrumental); clearSimpleMetadata(); }}
                className={`w-11 h-6 rounded-full flex items-center transition-colors duration-200 px-1 border border-zinc-200 dark:border-white/5 ${instrumental ? 'bg-pink-600' : 'bg-zinc-300 dark:bg-black/40'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${instrumental ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        )}

        {/* CUSTOM MODE */}
        {customMode && (
          <div className="space-y-5">
            {/* 1. Lyrics Input - FIRST */}
            <div
              ref={lyricsRef}
              className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden transition-colors group focus-within:border-zinc-400 dark:focus-within:border-white/20 relative flex flex-col"
              style={{ height: 'auto' }}
            >
              <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 flex-shrink-0">
                <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{t('lyrics')}</span>
                <div className="flex items-center gap-2">
                  <button
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 ${
                      isGeneratingLyrics
                        ? 'bg-violet-500 text-white'
                        : !lyrics.trim()
                          ? 'bg-violet-100/50 dark:bg-violet-500/10 text-violet-400 dark:text-violet-500 cursor-not-allowed'
                          : 'bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-500/30'
                    }`}
                    title="Generate lyrics with local LLM from your prompt"
                    onClick={handleGenerateLyrics}
                    disabled={isGeneratingLyrics || !lyrics.trim()}
                  >
                    {isGeneratingLyrics ? <Loader2 size={10} className="animate-spin" /> : <Music2 size={10} />}
                    <span>{isGeneratingLyrics ? 'Writing...' : 'Write'}</span>
                  </button>
                  <button
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
                    onClick={() => setLyrics('')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <textarea
                data-lyrics="true"
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="Leave empty for instrumental"
                className="w-full bg-transparent p-3 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none resize-none font-mono leading-relaxed"
                style={{ height: `${lyricsHeight}px` }}
              />
              {/* Tag inserter */}
              <div className="px-3 pb-2 flex flex-wrap gap-1">
                {['[Intro]','[Verse]','[Pre-Chorus]','[Chorus]','[Bridge]','[Outro]','[Hook]','[Instrumental Break]','[Solo]','[Interlude]'].map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-lyrics]');
                      if (ta) {
                        const start = ta.selectionStart;
                        const end = ta.selectionEnd;
                        const before = lyrics.slice(0, start);
                        const after = lyrics.slice(end);
                        const insert = (before && !before.endsWith('\n') ? '\n' : '') + tag + '\n';
                        setLyrics(before + insert + after);
                        setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + insert.length; ta.focus(); }, 0);
                      } else {
                        setLyrics(prev => prev + (prev && !prev.endsWith('\n') ? '\n' : '') + tag + '\n');
                      }
                    }}
                    className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white border border-zinc-200 dark:border-white/5 transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              {/* Resize Handle */}
              <div
                onMouseDown={startResizing}
                className="h-3 w-full cursor-ns-resize flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors absolute bottom-0 left-0 z-10"
              >
                <div className="w-8 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700"></div>
              </div>
            </div>

            {/* 2. Style Input - SECOND */}
            <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden transition-colors group focus-within:border-zinc-400 dark:focus-within:border-white/20">
              <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5">
                <div>
                  <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{t('styleOfMusic')}</span>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{t('genreMoodInstruments')}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded transition-colors text-zinc-500 hover:text-black dark:hover:text-white"
                    title={t('refreshGenres')}
                    onClick={refreshMusicTags}
                  >
                    <Dices size={14} />
                  </button>
                  <button
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
                    onClick={() => setStyle('')}
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    className={`p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded transition-colors ${isGeneratingStyle ? 'text-pink-500' : 'text-zinc-500 hover:text-black dark:hover:text-white'}`}
                    title="Generate Style - AI generates a detailed style description"
                    onClick={handleGenerateStyle}
                    disabled={isGeneratingStyle}
                  >
                    {isGeneratingStyle ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  </button>
                </div>
              </div>
              <textarea
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={t('stylePlaceholder')}
                className="w-full h-20 bg-transparent p-3 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none resize-none"
              />
              <div className="px-3 pb-3 space-y-3">
                {/* Quick Tags */}
                <div className="flex flex-wrap gap-2">
                  {musicTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => setStyle(prev => prev ? `${prev}, ${tag}` : tag)}
                      className="text-[10px] font-medium bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white px-2.5 py-1 rounded-full transition-colors border border-zinc-200 dark:border-white/5"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Music Card — compact rows in one dark card */}
            <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden p-2 space-y-1.5">
              <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Vocal Gender</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setVocalGender(vocalGender === 'male' ? '' : 'male')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${vocalGender === 'male' ? 'bg-pink-600 text-white' : 'text-zinc-500 dark:text-zinc-400 hover:text-white'}`}
                  >{t('male')}</button>
                  <button type="button" onClick={() => setVocalGender(vocalGender === 'female' ? '' : 'female')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${vocalGender === 'female' ? 'bg-pink-600 text-white' : 'text-zinc-500 dark:text-zinc-400 hover:text-white'}`}
                  >{t('female')}</button>
                </div>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Language</span>
                <select value={vocalLanguage} onChange={(e) => setVocalLanguage(e.target.value)}
                  className="bg-transparent border-none text-[11px] font-medium text-zinc-900 dark:text-white focus:outline-none cursor-pointer text-right [&>option]:bg-white [&>option]:dark:bg-zinc-800"
                >
                  {VOCAL_LANGUAGE_KEYS.map(lang => (<option key={lang.value} value={lang.value}>{t(lang.key)}</option>))}
                </select>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">BPM</span>
                <input type="number" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} placeholder="Auto"
                  className="w-16 bg-transparent border-none text-[11px] font-medium text-zinc-900 dark:text-white text-right focus:outline-none"
                />
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Key</span>
                <select value={keyScale} onChange={(e) => setKeyScale(e.target.value)}
                  className="bg-transparent border-none text-[11px] font-medium text-zinc-900 dark:text-white focus:outline-none cursor-pointer text-right [&>option]:bg-white [&>option]:dark:bg-zinc-800"
                >
                  <option value="">Auto</option>
                  {KEY_SIGNATURES.filter(k => k).map(key => (<option key={key} value={key}>{key}</option>))}
                </select>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Time</span>
                <select value={timeSignature} onChange={(e) => setTimeSignature(e.target.value)}
                  className="bg-transparent border-none text-[11px] font-medium text-zinc-900 dark:text-white focus:outline-none cursor-pointer text-right [&>option]:bg-white [&>option]:dark:bg-zinc-800"
                >
                  <option value="">Auto</option>
                  {TIME_SIGNATURES.filter(t => t).map(time => (<option key={time} value={time}>{time}</option>))}
                </select>
              </div>
            </div>

            {/* 4. Reference Audio / Cover */}
            <div
              onDrop={(e) => handleDrop(e, audioTab)}
              onDragOver={handleDragOver}
              className="bg-white dark:bg-[#1a1a1f] rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden"
            >
              {/* Header with Audio label and tabs */}
              <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{t('audio')}</span>
                  <div className="flex items-center gap-1 bg-zinc-200/50 dark:bg-black/30 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setAudioTab('reference')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                        audioTab === 'reference'
                          ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                      }`}
                    >
                      {t('reference')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAudioTab('source')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                        audioTab === 'source'
                          ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                      }`}
                    >
                      {t('cover')}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5">
                  {audioTab === 'reference'
                    ? 'Style inspiration \u2014 the AI listens to this track and generates music with a similar feel, without copying the melody'
                    : 'Source for covers \u2014 the AI recreates this track in your chosen style. Also used for audio-to-audio and repaint modes'}
                </p>
              </div>

              {/* Audio Content */}
              <div className="p-3 space-y-2">
                {/* Reference Audio Player */}
                {audioTab === 'reference' && referenceAudioUrl && (
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-50 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/5">
                    <button
                      type="button"
                      onClick={() => toggleAudio('reference')}
                      className="relative flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-pink-500/20 hover:scale-105 transition-transform"
                    >
                      {referencePlaying ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                      ) : (
                        <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      )}
                      <span className="absolute -bottom-1 -right-1 text-[8px] font-bold bg-zinc-900 text-white px-1 py-0.5 rounded">
                        {formatTime(referenceDuration)}
                      </span>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate mb-1.5">
                        {referenceAudioTitle || getAudioLabel(referenceAudioUrl)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(referenceTime)}</span>
                        <div
                          className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                          onClick={(e) => {
                            if (referenceAudioRef.current && referenceDuration > 0) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const percent = (e.clientX - rect.left) / rect.width;
                              referenceAudioRef.current.currentTime = percent * referenceDuration;
                            }
                          }}
                        >
                          <div
                            className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full transition-all relative"
                            style={{ width: referenceDuration ? `${Math.min(100, (referenceTime / referenceDuration) * 100)}%` : '0%' }}
                          >
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(referenceDuration)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setReferenceAudioUrl(''); setReferenceAudioTitle(''); setReferencePlaying(false); setReferenceTime(0); setReferenceDuration(0); }}
                      className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                )}

                {/* Source/Cover Audio Player */}
                {audioTab === 'source' && sourceAudioUrl && (
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-50 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/5">
                    <button
                      type="button"
                      onClick={() => toggleAudio('source')}
                      className="relative flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20 hover:scale-105 transition-transform"
                    >
                      {sourcePlaying ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                      ) : (
                        <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      )}
                      <span className="absolute -bottom-1 -right-1 text-[8px] font-bold bg-zinc-900 text-white px-1 py-0.5 rounded">
                        {formatTime(sourceDuration)}
                      </span>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate mb-1.5">
                        {sourceAudioTitle || getAudioLabel(sourceAudioUrl)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(sourceTime)}</span>
                        <div
                          className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                          onClick={(e) => {
                            if (sourceAudioRef.current && sourceDuration > 0) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const percent = (e.clientX - rect.left) / rect.width;
                              sourceAudioRef.current.currentTime = percent * sourceDuration;
                            }
                          }}
                        >
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all relative"
                            style={{ width: sourceDuration ? `${Math.min(100, (sourceTime / sourceDuration) * 100)}%` : '0%' }}
                          >
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-400 tabular-nums">{formatTime(sourceDuration)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setSourceAudioUrl(''); setSourceAudioTitle(''); setSourcePlaying(false); setSourceTime(0); setSourceDuration(0); }}
                      className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openAudioModal(audioTab, 'uploads')}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 px-3 py-2 text-xs font-medium transition-colors border border-zinc-200 dark:border-white/5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                    </svg>
                    {t('fromLibrary')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const input = audioTab === 'reference' ? referenceInputRef.current : sourceInputRef.current;
                      input?.click();
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 px-3 py-2 text-xs font-medium transition-colors border border-zinc-200 dark:border-white/5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                    </svg>
                    {t('upload')}
                  </button>
                </div>
              </div>
            </div>

            {/* Title Input */}
            <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden">
              <div className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/5">
                {t('title')}
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('nameSong')}
                className="w-full bg-transparent p-3 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* COMMON SETTINGS */}
        <div className="space-y-4">
        </div>

        {/* LORA CONTROL PANEL */}
        {customMode && (
          <>
            <button
              onClick={() => setShowLoraPanel(!showLoraPanel)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sliders size={16} className="text-zinc-500" />
                <span>LoRA</span>
              </div>
              <ChevronDown size={16} className={`text-zinc-500 transition-transform ${showLoraPanel ? 'rotate-180' : ''}`} />
            </button>

            {showLoraPanel && (
              <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 p-4 space-y-4">
                {/* LoRA Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('loraPath')}</label>
                  {availableLoras.length > 0 ? (
                    <select
                      value={availableLoras.includes(loraPath) ? loraPath : '__custom__'}
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') setLoraPath(e.target.value);
                      }}
                      className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 dark:focus:border-pink-500 transition-colors cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800"
                    >
                      {availableLoras.map(p => (
                        <option key={p} value={p}>{p.replace(/.*lora_output\//, '').replace(/\/adapter$/, '') || p}</option>
                      ))}
                      <option value="__custom__">Custom path...</option>
                    </select>
                  ) : null}
                  {(availableLoras.length === 0 || !availableLoras.includes(loraPath)) && (
                    <input
                      type="text"
                      value={loraPath}
                      onChange={(e) => setLoraPath(e.target.value)}
                      placeholder={t('loraPathPlaceholder')}
                      className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-pink-500 dark:focus:border-pink-500 transition-colors"
                    />
                  )}
                </div>

                {/* LoRA Load/Unload Toggle */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 border-t border-zinc-100 dark:border-white/5">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        loraLoaded ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                      }`}></div>
                      <span className={`text-xs font-medium ${
                        loraLoaded ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {loraLoaded ? t('loraLoaded') : t('loraUnloaded')}
                      </span>
                    </div>
                    <button
                      onClick={handleLoraToggle}
                      disabled={!loraPath.trim() || isLoraLoading}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        loraLoaded
                          ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/20 hover:from-green-600 hover:to-emerald-700'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {isLoraLoading ? '...' : (loraLoaded ? t('loraUnload') : t('loraLoad'))}
                    </button>
                  </div>
                  {loraError && (
                    <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                      {loraError}
                    </div>
                  )}
                </div>

                {/* Use LoRA Checkbox (enable/disable without unloading) */}
                <div className={`flex items-center justify-between py-2 border-t border-zinc-100 dark:border-white/5 ${!loraLoaded ? 'opacity-40 pointer-events-none' : ''}`}>
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={loraEnabled}
                      onChange={handleLoraEnabledToggle}
                      disabled={!loraLoaded}
                      className="accent-pink-600"
                    />
                    Use LoRA
                  </label>
                </div>

                {/* LoRA Scale Slider */}
                <div className={!loraLoaded || !loraEnabled ? 'opacity-40 pointer-events-none' : ''}>
                  <EditableSlider
                    label={t('loraScale')}
                    value={loraScale}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={handleLoraScaleChange}
                    formatDisplay={(val) => val.toFixed(2)}
                    helpText={t('loraScaleDescription')}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* ADVANCED SETTINGS - Custom mode only */}
        {customMode && (<>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-zinc-500" />
            <span>{t('advancedSettings')}</span>
          </div>
          <ChevronDown size={16} className={`text-zinc-500 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>

        {showAdvanced && (
          <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5 p-4 space-y-4">

            {/* ── Group 1: Generation (always visible) ── */}
            <EditableSlider
              label={t('duration')}
              value={duration}
              min={-1}
              max={600}
              step={5}
              onChange={setDuration}
              formatDisplay={(val) => val === -1 ? t('auto') : `${val}${t('seconds')}`}
              autoLabel={t('auto')}
              helpText={`${t('auto')} - 10 ${t('min')}`}
            />

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Task Type</label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-xl px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 dark:focus:border-pink-500 transition-colors cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800 [&>option]:text-zinc-900 [&>option]:dark:text-white"
              >
                <option value="text2music">Text to Music</option>
                <option value="cover">Cover</option>
                <option value="audio2audio">Audio to Audio</option>
                <option value="repaint">Repaint</option>
              </select>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {taskType === 'text2music' && 'Generate music from your style description and lyrics'}
                {taskType === 'cover' && 'Recreate the source audio in a new style. Upload source audio in the Cover tab above'}
                {taskType === 'audio2audio' && 'Transform source audio based on your style changes. Upload source audio above'}
                {taskType === 'repaint' && 'Modify a specific time range of the source audio'}
              </p>
            </div>

            {(taskType === 'cover' || taskType === 'audio2audio') && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Source Influence</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={audioCoverStrength}
                  onChange={(e) => setAudioCoverStrength(Number(e.target.value))}
                  className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">How much the original audio shapes the result (0 = ignore, 1 = faithful)</p>
              </div>
            )}

            {taskType === 'repaint' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Time Range to Modify</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-zinc-400">Start (sec)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={repaintingStart}
                      onChange={(e) => setRepaintingStart(Number(e.target.value))}
                      className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-zinc-400">End (sec)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={repaintingEnd}
                      onChange={(e) => setRepaintingEnd(Number(e.target.value))}
                      className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {uploadError && (
              <div className="text-[11px] text-rose-500">{uploadError}</div>
            )}

            {/* ── Group 2: Audio Analysis (collapsible) ── */}
            <button
              type="button"
              onClick={() => setShowAudioAnalysis(!showAudioAnalysis)}
              className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-white/5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors"
            >
              <span>Audio Analysis — Extract codes and metadata from source audio</span>
              <ChevronDown size={14} className={`transition-transform ${showAudioAnalysis ? 'rotate-180' : ''}`} />
            </button>
            {showAudioAnalysis && (
              <div className="mt-2 space-y-3">
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Extract a musical fingerprint from source audio for precise conditioning</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('audioCodes')}</label>
                  <textarea
                    value={audioCodes}
                    onChange={(e) => setAudioCodes(e.target.value)}
                    placeholder={t('optionalAudioCodes')}
                    className="w-full h-16 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg p-2 text-xs text-zinc-900 dark:text-white focus:outline-none resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!sourceAudioUrl || extractingCodes) return;
                        setExtractingCodes(true);
                        setUploadError(null);
                        try {
                          const res = await fetch('/api/generate/extract-codes', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ audioUrl: sourceAudioUrl }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || 'Extract codes failed');
                          if (data.codes) setAudioCodes(data.codes);
                        } catch (err: any) {
                          setUploadError(err.message || 'Failed to extract codes');
                        } finally {
                          setExtractingCodes(false);
                        }
                      }}
                      disabled={!sourceAudioUrl || extractingCodes}
                      title="Convert source audio to LM codes (requires source audio)"
                      className="px-2 py-1 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {extractingCodes ? 'Extracting...' : 'Convert to Codes'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!sourceAudioUrl || transcribing) return;
                        setTranscribing(true);
                        setUploadError(null);
                        try {
                          const res = await fetch('/api/generate/full-analysis', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ audioUrl: sourceAudioUrl }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || 'Full analysis failed');
                          if (data.codes) setAudioCodes(data.codes);
                          if (data.bpm && data.bpm > 0) setBpm(data.bpm);
                          if (data.key) setKeyScale(data.key);
                          if (data.timeSignature) setTimeSignature(data.timeSignature);
                          if (data.duration && data.duration > 0) setDuration(data.duration);
                          if (data.prompt) setStyle(data.prompt);
                          if (data.lyrics) setLyrics(data.lyrics);
                        } catch (err: any) {
                          setUploadError(err.message || 'Failed to transcribe');
                        } finally {
                          setTranscribing(false);
                        }
                      }}
                      disabled={!sourceAudioUrl || transcribing}
                      title="Analyze source audio to extract metadata (BPM, key, genre, lyrics, etc.)"
                      className="px-2 py-1 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {transcribing ? 'Analyzing...' : 'Full Analysis'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Group 3: Track Selection (collapsible) ── */}
            <button
              type="button"
              onClick={() => setShowTrackSelection(!showTrackSelection)}
              className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-white/5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors"
            >
              <span>Track Selection — Generate specific instruments</span>
              <ChevronDown size={14} className={`transition-transform ${showTrackSelection ? 'rotate-180' : ''}`} />
            </button>
            {showTrackSelection && (
              <div className="mt-2 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('trackName')}</label>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Focus generation on a specific instrument type</p>
                  <select
                    value={trackName}
                    onChange={(e) => setTrackName(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800"
                  >
                    <option value="">None</option>
                    {TRACK_NAMES.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('completeTrackClasses')}</label>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Select which instruments to include in the output</p>
                  <div className="flex flex-wrap gap-2">
                    {TRACK_NAMES.map(name => {
                      const selected = completeTrackClasses.split(',').map(s => s.trim()).filter(Boolean);
                      const isChecked = selected.includes(name);
                      return (
                        <label key={name} className="flex items-center gap-1 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              const next = isChecked
                                ? selected.filter(s => s !== name)
                                : [...selected, name];
                              setCompleteTrackClasses(next.join(','));
                            }}
                            className="accent-pink-600"
                          />
                          {name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── Group 4: Expert Tuning (collapsible) ── */}
            <button
              type="button"
              onClick={() => setShowExpertTuning(!showExpertTuning)}
              className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-white/5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors"
            >
              <span>Expert Tuning — Fine-tune the generation process</span>
              <ChevronDown size={14} className={`transition-transform ${showExpertTuning ? 'rotate-180' : ''}`} />
            </button>
            {showExpertTuning && (
              <div className="mt-2 space-y-3">
                {/* Instruction */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Instruction</label>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Additional directives for the AI</p>
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    className="w-full h-16 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg p-2 text-xs text-zinc-900 dark:text-white focus:outline-none resize-none"
                  />
                </div>

                {/* Guidance */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">CFG Interval</label>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Control when guidance is applied during diffusion (0=start, 1=end)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400">Start</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        value={cfgIntervalStart}
                        onChange={(e) => setCfgIntervalStart(Number(e.target.value))}
                        className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400">End</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        value={cfgIntervalEnd}
                        onChange={(e) => setCfgIntervalEnd(Number(e.target.value))}
                        className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Custom Timesteps */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('customTimesteps')}</label>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Override the diffusion schedule (comma-separated values)</p>
                  <input
                    type="text"
                    value={customTimesteps}
                    onChange={(e) => setCustomTimesteps(e.target.value)}
                    placeholder={t('timestepsPlaceholder')}
                    className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                  />
                </div>

                {/* Score Scale + LM Batch Chunk Size */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400" title="Scales score-based guidance.">{t('scoreScale')}</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="1"
                      value={scoreScale}
                      onChange={(e) => setScoreScale(Number(e.target.value))}
                      className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400" title="Bigger chunks = faster but more VRAM.">{t('lmBatchChunkSize')}</label>
                    <input
                      type="number"
                      min="1"
                      max="32"
                      step="1"
                      value={lmBatchChunkSize}
                      onChange={(e) => setLmBatchChunkSize(Number(e.target.value))}
                      className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                    />
                  </div>
                </div>

                {/* Toggle checkboxes — Quality */}
                <div className="space-y-1.5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-bold">Quality</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Adaptive Dual Guidance: dynamically adjusts CFG for quality. Base model only; slower.">
                      <input type="checkbox" checked={useAdg} onChange={() => setUseAdg(!useAdg)} className="accent-pink-600" />
                      {t('useAdg')}
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Use the formatted caption produced by the AI formatter.">
                      <input type="checkbox" checked={isFormatCaption} onChange={() => setIsFormatCaption(!isFormatCaption)} className="accent-pink-600" />
                      {t('formatCaption')}
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Return scorer outputs for diagnostics.">
                      <input type="checkbox" checked={getScores} onChange={() => setGetScores(!getScores)} className="accent-pink-600" />
                      {t('getScores')}
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Return synced lyric (LRC) output when available.">
                      <input type="checkbox" checked={getLrc} onChange={() => setGetLrc(!getLrc)} className="accent-pink-600" />
                      {t('getLrcLyrics')}
                    </label>
                  </div>
                </div>

                {/* Toggle checkboxes — LM */}
                <div className="space-y-1.5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-bold">LM Controls</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Let the LM reason about metadata like BPM, key, duration.">
                      <input type="checkbox" checked={useCotMetas} onChange={() => setUseCotMetas(!useCotMetas)} className="accent-pink-600" />
                      {t('useCotMetas')}
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Let the LM reason about the caption/style text.">
                      <input type="checkbox" checked={useCotCaption} onChange={() => setUseCotCaption(!useCotCaption)} className="accent-pink-600" />
                      {t('useCotCaption')}
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Let the LM reason about language selection.">
                      <input type="checkbox" checked={useCotLanguage} onChange={() => setUseCotLanguage(!useCotLanguage)} className="accent-pink-600" />
                      {t('useCotLanguage')}
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Allow the LM to run in larger batches for speed (more VRAM).">
                      <input type="checkbox" checked={allowLmBatch} onChange={() => setAllowLmBatch(!allowLmBatch)} className="accent-pink-600" />
                      {t('allowLmBatch')}
                    </label>
                  </div>
                </div>

                {/* Toggle checkboxes — Other */}
                <div className="space-y-1.5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-bold">Other</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Auto-generate missing fields when possible.">
                      <input type="checkbox" checked={autogen} onChange={() => setAutogen(!autogen)} className="accent-pink-600" />
                      {t('autogen')}
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer" title="Include debug info for constrained decoding.">
                      <input type="checkbox" checked={constrainedDecodingDebug} onChange={() => setConstrainedDecodingDebug(!constrainedDecodingDebug)} className="accent-pink-600" />
                      {t('constrainedDecodingDebug')}
                    </label>
                  </div>
                </div>

                {/* Load Parameters JSON — small link at bottom */}
                <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer transition-colors mt-2">
                  <Upload size={12} />
                  Load Parameters (JSON)
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleLoadParamsFile}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>
        )}
        </>)}
      </div>

      {showAudioModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowAudioModal(false); setPlayingTrackId(null); setPlayingTrackSource(null); }}
          />
          <div className="relative w-[92%] max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-zinc-900 dark:text-white">
                    {audioModalTarget === 'reference' ? t('referenceModalTitle') : t('coverModalTitle')}
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    {audioModalTarget === 'reference'
                      ? t('referenceModalDescription')
                      : t('coverModalDescription')}
                  </p>
                </div>
                <button
                  onClick={() => { setShowAudioModal(false); setPlayingTrackId(null); setPlayingTrackSource(null); }}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              {/* Upload Button */}
              <button
                type="button"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.mp3,.wav,.flac,.m4a,.mp4,audio/*';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) void uploadReferenceTrack(file);
                  };
                  input.click();
                }}
                disabled={isUploadingReference || isTranscribingReference}
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-white/5 px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/10 hover:border-zinc-400 dark:hover:border-white/30 transition-all"
              >
                {isUploadingReference ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    {t('uploadingAudio')}
                  </>
                ) : isTranscribingReference ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    {t('transcribing')}
                  </>
                ) : (
                  <>
                    <Upload size={16} />
                    {t('uploadAudio')}
                    <span className="text-xs text-zinc-400 ml-1">{t('audioFormats')}</span>
                  </>
                )}
              </button>

              {uploadError && (
                <div className="mt-2 text-xs text-rose-500">{uploadError}</div>
              )}
              {isTranscribingReference && (
                <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
                  <span>{t('transcribingWithWhisper')}</span>
                  <button
                    type="button"
                    onClick={cancelTranscription}
                    className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                  >
                    {t('cancel')}
                  </button>
                </div>
              )}
            </div>

            {/* Library Section */}
            <div className="border-t border-zinc-100 dark:border-white/5">
              <div className="px-5 py-3 flex items-center gap-2">
                <div className="flex items-center gap-1 bg-zinc-200/60 dark:bg-white/10 rounded-full p-0.5">
                  <button
                    type="button"
                    onClick={() => setLibraryTab('uploads')}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      libraryTab === 'uploads'
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t('uploaded')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryTab('created')}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      libraryTab === 'created'
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    {t('createdTab')}
                  </button>
                </div>
              </div>

              {/* Track List */}
              <div className="max-h-[280px] overflow-y-auto">
                {libraryTab === 'uploads' ? (
                  isLoadingTracks ? (
                    <div className="px-5 py-8 text-center">
                      <RefreshCw size={20} className="animate-spin mx-auto text-zinc-400" />
                      <p className="text-xs text-zinc-400 mt-2">{t('loadingTracks')}</p>
                    </div>
                  ) : referenceTracks.length === 0 ? (
                    <div className="px-5 py-8 text-center">
                      <Music2 size={24} className="mx-auto text-zinc-300 dark:text-zinc-600" />
                      <p className="text-sm text-zinc-400 mt-2">{t('noTracksYet')}</p>
                      <p className="text-xs text-zinc-400 mt-1">{t('uploadAudioFilesAsReferences')}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-white/5">
                      {referenceTracks.map((track) => (
                        <div
                          key={track.id}
                          className="px-5 py-3 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group"
                        >
                          {/* Play Button */}
                          <button
                            type="button"
                            onClick={() => toggleModalTrack({ id: track.id, audio_url: track.audio_url, source: 'uploads' })}
                            className="flex-shrink-0 w-9 h-9 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"
                          >
                            {playingTrackId === track.id && playingTrackSource === 'uploads' ? (
                              <Pause size={14} fill="currentColor" />
                            ) : (
                              <Play size={14} fill="currentColor" className="ml-0.5" />
                            )}
                          </button>

                          {/* Track Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                                {track.filename.replace(/\.[^/.]+$/, '')}
                              </span>
                              {track.tags && track.tags.length > 0 && (
                                <div className="flex gap-1">
                                  {track.tags.slice(0, 2).map((tag, i) => (
                                    <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-400">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* Progress bar with seek - show when this track is playing */}
                            {playingTrackId === track.id && playingTrackSource === 'uploads' ? (
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[10px] text-zinc-400 tabular-nums w-8">
                                  {formatTime(modalTrackTime)}
                                </span>
                                <div
                                  className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                                  onClick={(e) => {
                                    if (modalAudioRef.current && modalTrackDuration > 0) {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      const percent = (e.clientX - rect.left) / rect.width;
                                      modalAudioRef.current.currentTime = percent * modalTrackDuration;
                                    }
                                  }}
                                >
                                  <div
                                    className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full relative"
                                    style={{ width: modalTrackDuration > 0 ? `${(modalTrackTime / modalTrackDuration) * 100}%` : '0%' }}
                                  >
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                                  </div>
                                </div>
                                <span className="text-[10px] text-zinc-400 tabular-nums w-8 text-right">
                                  {formatTime(modalTrackDuration)}
                                </span>
                              </div>
                            ) : (
                              <div className="text-xs text-zinc-400 mt-0.5">
                                {track.duration ? formatTime(track.duration) : '--:--'}
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => useReferenceTrack({ audio_url: track.audio_url, title: track.filename })}
                              className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
                            >
                              {t('useTrack')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteReferenceTrack(track.id)}
                              className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-rose-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : createdTrackOptions.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <Music2 size={24} className="mx-auto text-zinc-300 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-400 mt-2">{t('noCreatedSongsYet')}</p>
                    <p className="text-xs text-zinc-400 mt-1">{t('generateSongsToReuse')}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-100 dark:divide-white/5">
                    {createdTrackOptions.map((track) => (
                      <div
                        key={track.id}
                        className="px-5 py-3 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group"
                      >
                        <button
                          type="button"
                          onClick={() => toggleModalTrack({ id: track.id, audio_url: track.audio_url, source: 'created' })}
                          className="flex-shrink-0 w-9 h-9 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"
                        >
                          {playingTrackId === track.id && playingTrackSource === 'created' ? (
                            <Pause size={14} fill="currentColor" />
                          ) : (
                            <Play size={14} fill="currentColor" className="ml-0.5" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                            {track.title}
                          </div>
                          {playingTrackId === track.id && playingTrackSource === 'created' ? (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[10px] text-zinc-400 tabular-nums w-8">
                                {formatTime(modalTrackTime)}
                              </span>
                              <div
                                className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                                onClick={(e) => {
                                  if (modalAudioRef.current && modalTrackDuration > 0) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const percent = (e.clientX - rect.left) / rect.width;
                                    modalAudioRef.current.currentTime = percent * modalTrackDuration;
                                  }
                                }}
                              >
                                <div
                                  className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full relative"
                                  style={{ width: modalTrackDuration > 0 ? `${(modalTrackTime / modalTrackDuration) * 100}%` : '0%' }}
                                >
                                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                                </div>
                              </div>
                              <span className="text-[10px] text-zinc-400 tabular-nums w-8 text-right">
                                {formatTime(modalTrackDuration)}
                              </span>
                            </div>
                          ) : (
                            <div className="text-xs text-zinc-400 mt-0.5">
                              {track.duration || '--:--'}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => useReferenceTrack({ audio_url: track.audio_url, title: track.title })}
                            className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
                          >
                            {t('useTrack')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Hidden audio element for modal playback */}
            <audio
              ref={modalAudioRef}
              onTimeUpdate={() => {
                if (modalAudioRef.current) {
                  setModalTrackTime(modalAudioRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (modalAudioRef.current) {
                  setModalTrackDuration(modalAudioRef.current.duration);
                  // Update track duration in database if not set
                  const track = referenceTracks.find(t => t.id === playingTrackId);
                  if (playingTrackSource === 'uploads' && track && !track.duration && token) {
                    fetch(`/api/reference-tracks/${track.id}`, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                      },
                      body: JSON.stringify({ duration: Math.round(modalAudioRef.current.duration) })
                    }).then(() => {
                      setReferenceTracks(prev => prev.map(t =>
                        t.id === track.id ? { ...t, duration: Math.round(modalAudioRef.current?.duration || 0) } : t
                      ));
                    }).catch(() => undefined);
                  }
                }
              }}
              onEnded={() => setPlayingTrackId(null)}
            />
          </div>
        </div>
      )}

      {/* Footer Create Button */}
      <div className="p-4 mt-auto sticky bottom-0 bg-zinc-50/95 dark:bg-suno-panel/95 backdrop-blur-sm z-10 border-t border-zinc-200 dark:border-white/5 space-y-3">
        <button
          onClick={customMode ? handleGenerate : handleSimpleGenerate}
          className="w-full h-12 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] bg-gradient-to-r from-orange-500 to-pink-600 text-white shadow-lg hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={isGenerating || !isAuthenticated}
        >
          <>
            <Sparkles size={18} />
            <span>
                {isGenerating
                  ? t('generating')
                  : customMode
                    ? bulkCount > 1
                      ? `${t('createButton')} ${bulkCount} ${t('jobs')} (${bulkCount * batchSize} ${t('variations')})`
                      : `${t('createButton')}${batchSize > 1 ? ` (${batchSize} ${t('variations')})` : ''}`
                    : t('createButton')
                }
              </span>
          </>
        </button>
      </div>
    </div>
  );
};
