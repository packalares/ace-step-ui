import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Download, Check } from 'lucide-react';
import { PageLayout } from './ui';
import { EditableSlider } from './EditableSlider';
import { useAuth } from '../context/AuthContext';
import { DIT_MODELS, LM_MODELS, LYRICS_MODELS } from '../data/models';

interface SettingsPageProps {
  onNavigate?: (view: string) => void;
}

interface DitModelInfo {
  name: string;
  is_active: boolean;
  is_preloaded: boolean;
}

interface InventoryModel {
  name: string;
  is_default?: boolean;
  is_loaded?: boolean;
  supported_task_types?: string[];
}

interface InventoryLmModel {
  name: string;
  is_loaded?: boolean;
}

// Helper to read from localStorage with a default
function lsGet(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}
function lsGetNum(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  return v !== null ? Number(v) : fallback;
}
function lsGetBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

// --- Generic Model Card (used for DiT, LM, and Lyrics models) ---
interface GenericModelCardProps {
  name: string;
  description: string;
  size: string;
  isActive: boolean;
  isAvailable: boolean;
  isSwitching: boolean;
  isDownloading: boolean;
  downloadError?: string;
  onClick: () => void;
  onDownload: () => void;
  activeLabel?: string;
  availableLabel?: string;
}

const GenericModelCard: React.FC<GenericModelCardProps> = ({
  name, description, size, isActive, isAvailable, isSwitching, isDownloading,
  downloadError, onClick, onDownload, activeLabel = 'Active', availableLabel = 'Ready',
}) => {
  const canSwitch = isAvailable && !isActive && !isSwitching;
  const needsDownload = !isAvailable && !isDownloading;

  return (
    <div
      className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
        isActive
          ? 'border-green-500/50 bg-green-50 dark:bg-green-500/10'
          : canSwitch
            ? 'bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/5 hover:border-pink-500/30 hover:bg-zinc-100 dark:hover:bg-white/10 cursor-pointer'
            : 'bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/5'
      } ${isSwitching ? 'opacity-60' : ''}`}
      onClick={canSwitch ? onClick : undefined}
      role={canSwitch ? 'button' : undefined}
      tabIndex={canSwitch ? 0 : undefined}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-sm font-semibold text-zinc-900 dark:text-white">{name}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">{size}</span>
          {isActive && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 flex items-center gap-1">
              {activeLabel === 'Selected' ? <Check size={9} /> : <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />}
              {activeLabel}
            </span>
          )}
          {!isActive && isAvailable && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
              {availableLabel}
            </span>
          )}
          {!isActive && !isAvailable && !isDownloading && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
              N/A
            </span>
          )}
          {isDownloading && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center gap-1">
              <Loader2 size={9} className="animate-spin" />
              DL...
            </span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight line-clamp-2">{description}</p>
      {needsDownload && (
        <button
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
          className="mt-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-pink-500 hover:bg-pink-600 text-white transition-colors flex items-center gap-1"
        >
          <Download size={10} />
          Download
        </button>
      )}
      {isSwitching && (
        <div className="flex items-center gap-1.5 mt-1 text-pink-500">
          <Loader2 size={12} className="animate-spin" />
          <span className="text-[10px] font-medium">Switching...</span>
        </div>
      )}
      {downloadError && (
        <div className="flex items-center gap-1.5 mt-1 text-red-500">
          <span className="text-[10px] font-medium">Failed: {downloadError}</span>
        </div>
      )}
    </div>
  );
};


export const SettingsPage: React.FC<SettingsPageProps> = ({ onNavigate }) => {
  const { token } = useAuth();

  // --- DiT Models State ---
  const [ditModels, setDitModels] = useState<DitModelInfo[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);
  const [switchWarning, setSwitchWarning] = useState<string | null>(null);

  // --- Download State ---
  const [downloadStates, setDownloadStates] = useState<Record<string, { status: string; error?: string }>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- LM Models State ---
  const [lmModels, setLmModels] = useState<InventoryLmModel[]>([]);
  const [selectedLm, setSelectedLm] = useState(() => lsGet('ace-lmModel', 'acestep-5Hz-lm-0.6B'));

  // --- Lyrics Models State ---
  const [lyricsModels, setLyricsModels] = useState<{ id: string; downloaded: boolean; downloading: boolean }[]>([]);
  const [selectedLyricsModel, setSelectedLyricsModel] = useState(() => lsGet('ace-lyricsModel', ''));
  const [lyricsDownloadStates, setLyricsDownloadStates] = useState<Record<string, { status: string; error?: string }>>({});
  const lyricsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Generation Defaults ---
  const [audioFormat, setAudioFormat] = useState<'mp3' | 'flac'>(() => lsGet('ace-audioFormat', 'mp3') as 'mp3' | 'flac');
  const [inferMethod, setInferMethod] = useState<'ode' | 'sde'>(() => lsGet('ace-inferMethod', 'ode') as 'ode' | 'sde');
  const [inferenceSteps, setInferenceSteps] = useState(() => lsGetNum('ace-inferenceSteps', 5));
  const [guidanceScale, setGuidanceScale] = useState(() => lsGetNum('ace-guidanceScale', 5));
  const [lmBackend, setLmBackend] = useState<'pt' | 'vllm'>(() => lsGet('ace-lmBackend', 'pt') as 'pt' | 'vllm');
  const [randomSeed, setRandomSeed] = useState(() => lsGetBool('ace-randomSeed', true));
  const [seed, setSeed] = useState(() => lsGetNum('ace-seed', -1));
  const [thinking, setThinking] = useState(() => lsGetBool('ace-thinking', false));
  const [shift, setShift] = useState(() => lsGetNum('ace-shift', 3));
  const [batchSize, setBatchSize] = useState(() => lsGetNum('ace-batchSize', 1));
  const [bulkCount, setBulkCount] = useState(() => lsGetNum('ace-bulkCount', 1));

  // --- LM Parameters ---
  const [lmTemperature, setLmTemperature] = useState(() => lsGetNum('ace-lmTemperature', 0.95));
  const [lmCfgScale, setLmCfgScale] = useState(() => lsGetNum('ace-lmCfgScale', 1.0));
  const [lmTopK, setLmTopK] = useState(() => lsGetNum('ace-lmTopK', 60));
  const [lmTopP, setLmTopP] = useState(() => lsGetNum('ace-lmTopP', 0.95));
  const [lmNegativePrompt, setLmNegativePrompt] = useState(() => lsGet('ace-lmNegativePrompt', ''));

  // Persist to localStorage on change
  const persist = useCallback((key: string, value: string | number | boolean) => {
    localStorage.setItem(key, String(value));
  }, []);

  // Fetch DiT models from API + inventory
  const fetchModels = useCallback(async () => {
    try {
      const [modelsRes, inventoryRes] = await Promise.all([
        fetch('/api/generate/models').catch(() => null),
        fetch('/api/generate/inventory').catch(() => null),
      ]);

      let models: DitModelInfo[] = [];
      if (modelsRes?.ok) {
        const data = await modelsRes.json();
        models = data.models || [];
      }

      let inventoryModels: InventoryModel[] = [];
      let inventoryLmModels: InventoryLmModel[] = [];
      if (inventoryRes?.ok) {
        const invData = await inventoryRes.json();
        inventoryModels = invData.data?.models || [];
        inventoryLmModels = invData.data?.lm_models || [];
      }

      // Merge: use /models as the primary list, enrich with inventory loaded status
      if (models.length > 0) {
        setDitModels(models);
        const active = models.find(m => m.is_active);
        if (active) setActiveModel(active.name);
      } else {
        // Fallback: build from inventory
        const fromInv = inventoryModels.map(m => ({
          name: m.name,
          is_active: m.is_default || false,
          is_preloaded: m.is_loaded || false,
        }));
        if (fromInv.length > 0) {
          setDitModels(fromInv);
          const active = fromInv.find(m => m.is_active);
          if (active) setActiveModel(active.name);
        }
      }

      // LM models: combine inventory + catalog
      const allLmNames = Object.keys(LM_MODELS);
      const lmResult: InventoryLmModel[] = allLmNames.map(name => {
        const fromInv = inventoryLmModels.find(m => m.name === name);
        return { name, is_loaded: fromInv?.is_loaded ?? false };
      });
      // Add any inventory LM models not in catalog
      inventoryLmModels.forEach(m => {
        if (!allLmNames.includes(m.name)) {
          lmResult.push(m);
        }
      });
      setLmModels(lmResult);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // --- Download status polling ---
  const pollDownloadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/generate/models/download-status');
      if (res.ok) {
        const data = await res.json();
        const downloads: Record<string, { status: string; error?: string }> = data.downloads || {};
        setDownloadStates(downloads);

        // If any download just finished (done or failed), refresh model list
        const hasActive = Object.values(downloads).some(d => d.status === 'downloading');
        const hasDone = Object.values(downloads).some(d => d.status === 'done');
        if (hasDone) {
          fetchModels();
        }
        // Stop polling if nothing is downloading
        if (!hasActive && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch { /* ignore */ }
  }, [fetchModels]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(pollDownloadStatus, 3000);
  }, [pollDownloadStatus]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const handleDownloadModel = async (modelName: string) => {
    try {
      const res = await fetch('/api/generate/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
      });
      if (res.ok) {
        setDownloadStates(prev => ({ ...prev, [modelName]: { status: 'downloading' } }));
        startPolling();
      }
    } catch (err) {
      console.error('Failed to start download:', err);
    }
  };

  const handleSwitchModel = async (modelName: string) => {
    if (switchingModel || modelName === activeModel) return;

    // If model is not downloaded, trigger download instead
    const model = ditModels.find(m => m.name === modelName);
    if (model && !model.is_preloaded) {
      return; // Don't switch — user should use Download button
    }

    setSwitchWarning(null);
    setSwitchingModel(modelName);
    try {
      const res = await fetch('/api/generate/models/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
      });
      if (res.ok) {
        const data = await res.json();
        const loadedModel = data?.data?.loaded_model || data?.loaded_model;
        if (loadedModel) {
          setActiveModel(loadedModel);
          localStorage.setItem('ace-model', loadedModel);
        }
        setSwitchWarning(null);
      }
    } catch (err) {
      console.error('Failed to switch model:', err);
    } finally {
      setSwitchingModel(null);
      fetchModels();
    }
  };

  const handleSelectLm = (name: string) => {
    setSelectedLm(name);
    persist('ace-lmModel', name);
  };

  // --- Lyrics Models ---
  const fetchLyricsModels = useCallback(async () => {
    try {
      const res = await fetch('/api/lyrics/models');
      if (res.ok) {
        const data = await res.json();
        const models = data.models || [];
        setLyricsModels(models);
        // Auto-select first downloaded model if none selected
        if (!selectedLyricsModel) {
          const firstDownloaded = models.find((m: { downloaded: boolean }) => m.downloaded);
          if (firstDownloaded) {
            setSelectedLyricsModel(firstDownloaded.id);
            persist('ace-lyricsModel', firstDownloaded.id);
          }
        }
      }
    } catch { /* ignore */ }
  }, [selectedLyricsModel, persist]);

  useEffect(() => {
    fetchLyricsModels();
  }, [fetchLyricsModels]);

  const pollLyricsDownloadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/lyrics/models/download-status');
      if (res.ok) {
        const data = await res.json();
        const downloads: Record<string, { status: string; error?: string }> = data.downloads || {};
        setLyricsDownloadStates(downloads);

        const hasActive = Object.values(downloads).some(d => d.status === 'downloading');
        const hasDone = Object.values(downloads).some(d => d.status === 'done');
        if (hasDone) {
          fetchLyricsModels();
        }
        if (!hasActive && lyricsPollRef.current) {
          clearInterval(lyricsPollRef.current);
          lyricsPollRef.current = null;
        }
      }
    } catch { /* ignore */ }
  }, [fetchLyricsModels]);

  const startLyricsPolling = useCallback(() => {
    if (lyricsPollRef.current) return;
    lyricsPollRef.current = setInterval(pollLyricsDownloadStatus, 3000);
  }, [pollLyricsDownloadStatus]);

  useEffect(() => {
    return () => {
      if (lyricsPollRef.current) {
        clearInterval(lyricsPollRef.current);
        lyricsPollRef.current = null;
      }
    };
  }, []);

  const handleDownloadLyricsModel = async (modelId: string) => {
    if (!token) return;
    try {
      const res = await fetch('/api/lyrics/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ modelId }),
      });
      if (res.ok) {
        setLyricsDownloadStates(prev => ({ ...prev, [modelId]: { status: 'downloading' } }));
        startLyricsPolling();
      }
    } catch (err) {
      console.error('Failed to start lyrics model download:', err);
    }
  };

  const handleSelectLyricsModel = (id: string) => {
    setSelectedLyricsModel(id);
    persist('ace-lyricsModel', id);
  };

  // Build DiT model list for display — use fetched models, fall back to catalog
  const ditModelList = ditModels.length > 0
    ? ditModels
    : Object.keys(DIT_MODELS).map(name => ({ name, is_active: false, is_preloaded: false }));

  return (
    <PageLayout title="Settings" subtitle="Configure models and generation defaults">
      <div className="space-y-3">

        {/* ===== DiT MODELS ===== */}
        <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5">
          <div className="px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl">
            <h2 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">DiT Models</h2>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">Music generation models -- click to switch active</p>
          </div>
          {switchWarning && (
            <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 text-xs text-amber-700 dark:text-amber-400">
              {switchWarning}
            </div>
          )}
          <div className="p-3">
            <div className="grid grid-cols-2 gap-2">
              {ditModelList.map(m => {
                const catalog = DIT_MODELS[m.name];
                const dlState = downloadStates[m.name];
                const isDownloading = dlState?.status === 'downloading';
                const downloadError = dlState?.status === 'failed' ? dlState.error : undefined;
                return (
                  <GenericModelCard
                    key={m.name}
                    name={m.name.replace('acestep-v15-', '')}
                    description={catalog?.description ?? 'DiT model'}
                    size={catalog?.size ?? '4.5 GB'}
                    isActive={activeModel === m.name}
                    isAvailable={m.is_preloaded || dlState?.status === 'done'}
                    isSwitching={switchingModel === m.name}
                    isDownloading={isDownloading}
                    downloadError={downloadError}
                    onClick={() => handleSwitchModel(m.name)}
                    onDownload={() => handleDownloadModel(m.name)}
                    activeLabel="Active"
                    availableLabel="Ready"
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* ===== LM MODELS ===== */}
        <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5">
          <div className="px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl">
            <h2 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">LM Models</h2>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">Language models for prompt understanding</p>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-2 gap-2">
              {(lmModels.length > 0 ? lmModels : Object.keys(LM_MODELS).map(name => ({ name, is_loaded: false }))).map(m => {
                const catalog = LM_MODELS[m.name];
                const dlState = downloadStates[m.name];
                const isDownloading = dlState?.status === 'downloading';
                const downloadError = dlState?.status === 'failed' ? dlState.error : undefined;
                return (
                  <GenericModelCard
                    key={m.name}
                    name={m.name.replace('acestep-5Hz-lm-', '')}
                    description={catalog?.description ?? 'Language model'}
                    size={catalog?.size ?? '?'}
                    isActive={selectedLm === m.name}
                    isAvailable={true}
                    isSwitching={false}
                    isDownloading={isDownloading}
                    downloadError={downloadError}
                    onClick={() => handleSelectLm(m.name)}
                    onDownload={() => handleDownloadModel(m.name)}
                    activeLabel="Selected"
                    availableLabel="Loaded"
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* ===== LYRICS MODELS ===== */}
        <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5">
          <div className="px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl">
            <h2 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Lyrics Models</h2>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">Local LLM for generating song lyrics (runs on CPU)</p>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-2 gap-2">
              {LYRICS_MODELS.map(m => {
                const serverModel = lyricsModels.find(sm => sm.id === m.id);
                const dlState = lyricsDownloadStates[m.id];
                const isDownloading = dlState?.status === 'downloading' || (serverModel?.downloading ?? false);
                const isDownloaded = (serverModel?.downloaded ?? false) || dlState?.status === 'done';
                const downloadError = dlState?.status === 'failed' ? dlState.error : undefined;
                return (
                  <GenericModelCard
                    key={m.id}
                    name={m.name}
                    description={m.description}
                    size={m.size}
                    isActive={selectedLyricsModel === m.id}
                    isAvailable={isDownloaded}
                    isSwitching={false}
                    isDownloading={isDownloading}
                    downloadError={downloadError}
                    onClick={() => handleSelectLyricsModel(m.id)}
                    onDownload={() => handleDownloadLyricsModel(m.id)}
                    activeLabel="Selected"
                    availableLabel="Downloaded"
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* ===== GENERATION DEFAULTS ===== */}
        <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5">
          <div className="px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl">
            <h2 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Generation Defaults</h2>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">Persisted defaults for new generations</p>
          </div>

          <div className="p-4 space-y-4">
            {/* Row 1: Audio Format + Inference Method */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title="Output file format. MP3 is smaller, FLAC is lossless quality.">Audio Format</label>
                <select
                  value={audioFormat}
                  onChange={(e) => { const v = e.target.value as 'mp3' | 'flac'; setAudioFormat(v); persist('ace-audioFormat', v); }}
                  className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 rounded-xl px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 dark:focus:border-pink-500 transition-colors cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800 [&>option]:text-zinc-900 [&>option]:dark:text-white"
                >
                  <option value="mp3">MP3 (smaller)</option>
                  <option value="flac">FLAC (lossless)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title="ODE is deterministic and repeatable. SDE adds randomness for variety.">Inference Method</label>
                <select
                  value={inferMethod}
                  onChange={(e) => { const v = e.target.value as 'ode' | 'sde'; setInferMethod(v); persist('ace-inferMethod', v); }}
                  className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 rounded-xl px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 dark:focus:border-pink-500 transition-colors cursor-pointer [&>option]:bg-white [&>option]:dark:bg-zinc-800 [&>option]:text-zinc-900 [&>option]:dark:text-white"
                >
                  <option value="ode">ODE (deterministic)</option>
                  <option value="sde">SDE (stochastic)</option>
                </select>
              </div>
            </div>

            {/* Row 2: Batch Size + Bulk Count */}
            <div className="grid grid-cols-2 gap-3">
              <EditableSlider
                label="Batch Size"
                value={batchSize}
                min={1}
                max={4}
                step={1}
                onChange={(v) => { setBatchSize(v); persist('ace-batchSize', v); }}
                helpText="Variations per run"
                title="Generate multiple variations in one run. Uses more VRAM."
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title="Queue multiple sequential generation jobs.">Bulk Generate</label>
                  <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">
                    {bulkCount}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 5, 10].map((count) => (
                    <button
                      key={count}
                      onClick={() => { setBulkCount(count); persist('ace-bulkCount', count); }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        bulkCount === count
                          ? 'bg-gradient-to-r from-orange-500 to-pink-600 text-white shadow-md'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-500">Queue multiple jobs</p>
              </div>
            </div>

            {/* Inference Steps */}
            <EditableSlider
              label="Inference Steps"
              value={inferenceSteps}
              min={1}
              max={200}
              step={1}
              onChange={(v) => { setInferenceSteps(v); persist('ace-inferenceSteps', v); }}
              helpText="More steps = better quality, slower"
              title="Number of diffusion steps. More steps = better quality but slower. Turbo models work with 5-10, base needs 20-50."
            />

            {/* Guidance Scale */}
            <EditableSlider
              label="Guidance Scale"
              value={guidanceScale}
              min={1}
              max={15}
              step={0.1}
              onChange={(v) => { setGuidanceScale(v); persist('ace-guidanceScale', v); }}
              formatDisplay={(val) => val.toFixed(1)}
              helpText="How closely the model follows your prompt"
              title="How strictly the model follows your prompt. Higher = more faithful, lower = more creative freedom."
            />

            {/* Row: LM Backend + Shift */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title="PyTorch (pt) is stable. vLLM is faster but may crash on some GPUs.">LM Backend</label>
                <select
                  value={lmBackend}
                  onChange={(e) => { const v = e.target.value as 'pt' | 'vllm'; setLmBackend(v); persist('ace-lmBackend', v); }}
                  className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 rounded-lg px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
                >
                  <option value="pt">PyTorch (pt)</option>
                  <option value="vllm">vLLM</option>
                </select>
              </div>
              <EditableSlider
                label="Shift"
                value={shift}
                min={1}
                max={5}
                step={0.1}
                onChange={(v) => { setShift(v); persist('ace-shift', v); }}
                formatDisplay={(val) => val.toFixed(1)}
                helpText="Timestep shift (base model)"
                title="Timestep schedule shift. Only affects base model. Higher = different frequency balance."
              />
            </div>

            {/* Row: Seed + Thinking */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title="Random seed gives variety. Fixed seed reproduces the exact same result.">Random Seed</span>
                  <button
                    onClick={() => { const v = !randomSeed; setRandomSeed(v); persist('ace-randomSeed', v); }}
                    className={`w-10 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 border border-zinc-200 dark:border-white/5 ${randomSeed ? 'bg-pink-600' : 'bg-zinc-300 dark:bg-black/40'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${randomSeed ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {!randomSeed && (
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => { const v = Number(e.target.value); setSeed(v); persist('ace-seed', v); }}
                    placeholder="Fixed seed"
                    className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
                  />
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title="Chain-of-thought reasoning. The LM thinks about structure before generating. Slightly slower.">Thinking / CoT</span>
                <button
                  onClick={() => { const v = !thinking; setThinking(v); persist('ace-thinking', v); }}
                  className={`w-10 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 border border-zinc-200 dark:border-white/5 ${thinking ? 'bg-pink-600' : 'bg-zinc-300 dark:bg-black/40'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${thinking ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ===== LM PARAMETERS ===== */}
        <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5">
          <div className="px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl">
            <h2 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">LM Parameters</h2>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">Control lyric and caption generation behavior</p>
          </div>

          <div className="p-4 space-y-4">
            {/* Row: Temperature + CFG Scale */}
            <div className="grid grid-cols-2 gap-3">
              <EditableSlider
                label="LM Temperature"
                value={lmTemperature}
                min={0}
                max={2}
                step={0.1}
                onChange={(v) => { setLmTemperature(v); persist('ace-lmTemperature', v); }}
                formatDisplay={(val) => val.toFixed(2)}
                helpText="Higher = more random"
                title="Controls randomness in text understanding. Higher = more creative, lower = more focused."
              />
              <EditableSlider
                label="LM CFG Scale"
                value={lmCfgScale}
                min={1}
                max={3}
                step={0.1}
                onChange={(v) => { setLmCfgScale(v); persist('ace-lmCfgScale', v); }}
                formatDisplay={(val) => val.toFixed(1)}
                helpText="Prompt adherence"
                title="Classifier-free guidance for the language model. Higher = stricter prompt following."
              />
            </div>

            {/* Row: Top-K + Top-P */}
            <div className="grid grid-cols-2 gap-3">
              <EditableSlider
                label="Top-K"
                value={lmTopK}
                min={0}
                max={100}
                step={1}
                onChange={(v) => { setLmTopK(v); persist('ace-lmTopK', v); }}
                title="Limits vocabulary choices to top K tokens. 0 = no limit."
              />
              <EditableSlider
                label="Top-P"
                value={lmTopP}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => { setLmTopP(v); persist('ace-lmTopP', v); }}
                formatDisplay={(val) => val.toFixed(2)}
                title="Nucleus sampling. Only considers tokens within cumulative probability P."
              />
            </div>

            {/* LM Negative Prompt */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title="Describe what to avoid. Only works when LM CFG Scale > 1.">LM Negative Prompt</label>
              <textarea
                value={lmNegativePrompt}
                onChange={(e) => { setLmNegativePrompt(e.target.value); persist('ace-lmNegativePrompt', e.target.value); }}
                placeholder="Things to avoid in generation..."
                className="w-full h-16 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/5 rounded-lg p-2 text-xs text-zinc-900 dark:text-white focus:outline-none resize-none"
              />
              <p className="text-[10px] text-zinc-500">Used when CFG scale &gt; 1</p>
            </div>
          </div>
        </div>
        {/* ===== GPU MANAGEMENT ===== */}
        <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5">
          <div className="px-3 py-2.5 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl">
            <h2 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">GPU Management</h2>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">Manage GPU memory and auto-unload</p>
          </div>
          <div className="p-3 space-y-3">
            <GpuSection token={token} />
          </div>
        </div>

      </div>
    </PageLayout>
  );
};

// --- GPU Management Section ---
const GpuSection: React.FC<{ token: string | null }> = ({ token }) => {
  const [gpuStatus, setGpuStatus] = React.useState<any>(null);
  const [unloading, setUnloading] = React.useState(false);
  const [autoMinutes, setAutoMinutes] = React.useState(0);

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch('/api/generate/gpu/status');
      if (res.ok) setGpuStatus(await res.json());
    } catch {}
  }, []);

  React.useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  React.useEffect(() => {
    if (gpuStatus?.autoUnloadMinutes !== undefined) {
      setAutoMinutes(gpuStatus.autoUnloadMinutes);
    }
  }, [gpuStatus?.autoUnloadMinutes]);

  const handleUnload = async () => {
    if (!token) return;
    if (!confirm('This will unload all GPU models. Any running generation will fail. Continue?')) return;
    setUnloading(true);
    try {
      const res = await fetch('/api/generate/gpu/unload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Unload failed');
      else fetchStatus();
    } catch (err) {
      alert('Unload failed');
    } finally {
      setUnloading(false);
    }
  };

  const handleAutoUnload = async (minutes: number) => {
    if (!token) return;
    setAutoMinutes(minutes);
    try {
      await fetch('/api/generate/gpu/auto-unload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ minutes }),
      });
    } catch {}
  };

  const inv = gpuStatus?.inventory;
  const loadedDit = inv?.models?.find((m: any) => m.is_loaded)?.name || 'None';
  const loadedLm = inv?.loaded_lm_model || 'None';

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2">
          <span className="text-[10px] text-zinc-500 block">DiT Model</span>
          <span className="text-[11px] font-medium text-zinc-900 dark:text-white">{loadedDit}</span>
        </div>
        <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2">
          <span className="text-[10px] text-zinc-500 block">LM Model</span>
          <span className="text-[11px] font-medium text-zinc-900 dark:text-white">{loadedLm}</span>
        </div>
        <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2">
          <span className="text-[10px] text-zinc-500 block">ACE-Step</span>
          <span className={`text-[11px] font-medium ${gpuStatus?.aceStepRunning ? 'text-green-400' : 'text-red-400'}`}>
            {gpuStatus?.aceStepRunning ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2">
          <span className="text-[10px] text-zinc-500 block">Idle Time</span>
          <span className="text-[11px] font-medium text-zinc-900 dark:text-white">{gpuStatus?.idleMinutes ?? '?'} min</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title="Automatically unload GPU models after idle time">Auto-unload after</span>
          <select
            value={autoMinutes}
            onChange={(e) => handleAutoUnload(Number(e.target.value))}
            className="ml-2 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1 text-[11px] text-zinc-900 dark:text-white focus:outline-none cursor-pointer"
          >
            <option value={0}>Disabled</option>
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
          </select>
        </div>
        <button
          onClick={handleUnload}
          disabled={unloading || !gpuStatus?.aceStepRunning}
          className="px-3 py-1.5 text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {unloading ? 'Unloading...' : 'Unload GPU'}
        </button>
      </div>
    </>
  );
};
