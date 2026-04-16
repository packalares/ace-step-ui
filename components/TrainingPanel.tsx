import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  Play, Square, Download, FolderOpen, Save, Loader2,
  Edit3, Upload, X, Volume2, FileAudio, Zap,
  Wand2, Check,
} from 'lucide-react';
import { PageLayout, Card, CardHeader, Button } from './ui';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { trainingApi, getTrainingAudioUrl, TrainingSample, DatasetSettings } from '../services/api';

interface DataframeRow {
  [key: string]: unknown;
}

const LANGUAGES = [
  { value: 'instrumental', label: 'Instrumental' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'unknown', label: 'Unknown' },
];

const TIME_SIGS = ['', '2', '3', '4', '6', 'N/A'];

// Pipeline step definitions
const PIPELINE_STEPS = [
  { key: 'upload', label: 'Upload', icon: Upload, num: 1 },
  { key: 'label', label: 'Label', icon: Wand2, num: 2 },
  { key: 'preprocess', label: 'Preprocess', icon: Zap, num: 3 },
  { key: 'train', label: 'Train', icon: Play, num: 4 },
  { key: 'export', label: 'Export', icon: Download, num: 5 },
] as const;

type StepKey = typeof PIPELINE_STEPS[number]['key'];

export const TrainingPanel: React.FC = () => {
  const { token } = useAuth();
  const { t } = useI18n();

  // Current wizard step
  const [activeStep, setActiveStep] = useState<StepKey>('upload');

  // Completed steps
  const [completedSteps, setCompletedSteps] = useState<Set<StepKey>>(new Set());

  // Upload state
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [uploadDatasetName, setUploadDatasetName] = useState('my_lora_dataset');
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dataset state
  const [datasetPath, setDatasetPath] = useState('./datasets/my_lora_dataset.json');
  const [datasetLoaded, setDatasetLoaded] = useState(false);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [currentSampleIdx, setCurrentSampleIdx] = useState(0);
  const [currentSample, setCurrentSample] = useState<TrainingSample | null>(null);
  const [datasetSettings, setDatasetSettings] = useState<DatasetSettings>({
    datasetName: 'my_lora_dataset',
    customTag: '',
    tagPosition: 'replace',
    allInstrumental: true,
    genreRatio: 0,
  });
  const [datasetStatus, setDatasetStatus] = useState('');

  // Dataset table state
  const [dataframeHeaders, setDataframeHeaders] = useState<string[]>([]);
  const [dataframeRows, setDataframeRows] = useState<DataframeRow[]>([]);

  // Auto-label state
  const [autoLabeling, setAutoLabeling] = useState(false);
  const [autoLabelStatus, setAutoLabelStatus] = useState('');
  const [skipMetas, setSkipMetas] = useState(false);
  const [formatLyrics, setFormatLyrics] = useState(false);
  const [transcribeLyrics, setTranscribeLyrics] = useState(false);
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(false);

  // Model init state (auto-init for label step)
  const [modelInitializing, setModelInitializing] = useState(false);
  const [modelInitStatus, setModelInitStatus] = useState('');
  const [modelInitDone, setModelInitDone] = useState(false);

  // Editing sample state
  const [editCaption, setEditCaption] = useState('');
  const [editGenre, setEditGenre] = useState('');
  const [editPromptOverride, setEditPromptOverride] = useState('Use Global Ratio');
  const [editLyrics, setEditLyrics] = useState('');
  const [editBpm, setEditBpm] = useState(120);
  const [editKey, setEditKey] = useState('');
  const [editTimeSig, setEditTimeSig] = useState('');
  const [editDuration, setEditDuration] = useState(0);
  const [editLanguage, setEditLanguage] = useState('instrumental');
  const [editInstrumental, setEditInstrumental] = useState(true);
  const [editRawLyrics, setEditRawLyrics] = useState('');

  // Dataset save state
  const [savePath, setSavePath] = useState('./datasets/my_lora_dataset.json');
  const [saveStatus, setSaveStatus] = useState('');
  const [editSaveStatus, setEditSaveStatus] = useState('');

  // Preprocess state
  const [preprocessOutputDir, setPreprocessOutputDir] = useState('./datasets/preprocessed_tensors');
  const [preprocessing, setPreprocessing] = useState(false);
  const [preprocessStatus, setPreprocessStatus] = useState('');

  // Training state
  const [trainingParams, setTrainingParams] = useState({
    tensorDir: './datasets/preprocessed_tensors',
    rank: 64,
    alpha: 128,
    dropout: 0.1,
    learningRate: 0.0003,
    epochs: 1000,
    batchSize: 1,
    gradientAccumulation: 1,
    saveEvery: 200,
    shift: 3.0,
    seed: 42,
    outputDir: './lora_output',
    resumeCheckpoint: '' as string,
  });
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState('');
  const [trainingLog, setTrainingLog] = useState('');
  const [trainingMetrics, setTrainingMetrics] = useState<unknown>(null);
  const [trainingDatasetInfo, setTrainingDatasetInfo] = useState('');

  // Export state
  const [exportPath, setExportPath] = useState('./lora_output/final_lora');
  const [exportOutputDir, setExportOutputDir] = useState('./lora_output');
  const [exportStatus, setExportStatus] = useState('');

  // Loading states
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Audio preview URL
  const audioPreviewUrl = useMemo(() => {
    if (!currentSample?.audio) return undefined;
    return getTrainingAudioUrl(currentSample.audio);
  }, [currentSample?.audio]);

  const markStep = useCallback((step: StepKey) => {
    setCompletedSteps(prev => new Set([...prev, step]));
  }, []);

  const canGoToStep = useCallback((step: StepKey) => {
    const stepIndex = PIPELINE_STEPS.findIndex(s => s.key === step);
    if (stepIndex === 0) return true;
    // Can go to a step if all previous steps are completed
    for (let i = 0; i < stepIndex; i++) {
      if (!completedSteps.has(PIPELINE_STEPS[i].key)) return false;
    }
    return true;
  }, [completedSteps]);

  const goToStep = useCallback((step: StepKey) => {
    if (canGoToStep(step)) {
      setActiveStep(step);
    }
  }, [canGoToStep]);

  const advanceToNext = useCallback((currentStep: StepKey) => {
    const idx = PIPELINE_STEPS.findIndex(s => s.key === currentStep);
    if (idx < PIPELINE_STEPS.length - 1) {
      setActiveStep(PIPELINE_STEPS[idx + 1].key);
    }
  }, []);

  const populateSampleFields = (sample: TrainingSample) => {
    setEditCaption(sample.caption || '');
    setEditGenre(sample.genre || '');
    setEditPromptOverride(sample.promptOverride || 'Use Global Ratio');
    setEditLyrics(sample.lyrics || '');
    setEditBpm(sample.bpm || 120);
    setEditKey(sample.key || '');
    setEditTimeSig(sample.timeSignature || '');
    setEditDuration(sample.duration || 0);
    setEditLanguage(sample.language || 'instrumental');
    setEditInstrumental(sample.instrumental ?? true);
    setEditRawLyrics(sample.rawLyrics || '');
  };

  // Parse dataframe from Gradio response
  const parseDataframe = (df: unknown) => {
    if (!df || typeof df !== 'object') return;
    const dfObj = df as { headers?: string[]; data?: unknown[][] };
    if (dfObj.headers && Array.isArray(dfObj.data)) {
      setDataframeHeaders(dfObj.headers);
      setDataframeRows(dfObj.data.map(row => {
        const obj: DataframeRow = {};
        dfObj.headers!.forEach((h, i) => { obj[h] = row[i]; });
        return obj;
      }));
    }
  };

  // Auto-init models when entering label step
  useEffect(() => {
    if (activeStep !== 'label' || modelInitDone || modelInitializing) return;
    const initModels = async () => {
      setModelInitializing(true);
      setModelInitStatus('Initializing models for labeling...');
      try {
        // Force-load DiT model weights (ACESTEP_NO_INIT=true means lazy load)
        setModelInitStatus('Loading DiT model...');
        const reinitRes = await fetch('/api/generate/inventory');
        const invData = reinitRes.ok ? await reinitRes.json() : null;
        const ditLoaded = invData?.data?.models?.some((m: any) => m.is_loaded);

        if (!ditLoaded) {
          // Reinitialize to force-load model weights
          await fetch('/api/training/init-model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ reinitialize: true }),
          });
        }

        // Init LLM for labeling
        setModelInitStatus('Loading language model...');
        const lmModel = localStorage.getItem('ace-lmModel') || 'acestep-5Hz-lm-1.7B';
        await fetch('/api/generate/models/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: localStorage.getItem('ace-model') || 'acestep-v15-turbo', init_llm: true, lm_model_path: lmModel }),
        }).catch(() => null);

        setModelInitStatus('Models ready');
        setModelInitDone(true);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Init failed';
        setModelInitStatus(msg.includes('501') ? 'Use Gradio UI to initialize model' : msg);
      } finally {
        setModelInitializing(false);
      }
    };
    initModels();
  }, [activeStep, modelInitDone, modelInitializing, token]);

  // Mutual exclusion: formatLyrics / transcribeLyrics
  useEffect(() => {
    if (formatLyrics && transcribeLyrics) setTranscribeLyrics(false);
  }, [formatLyrics]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (transcribeLyrics && formatLyrics) setFormatLyrics(false);
  }, [transcribeLyrics]); // eslint-disable-line react-hooks/exhaustive-deps

  // === Drop zone handlers ===
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f: File) => {
      const ext = f.name.toLowerCase().split('.').pop();
      return ['wav', 'mp3', 'flac', 'ogg', 'opus'].includes(ext || '');
    });
    if (files.length > 0) {
      setQueuedFiles(prev => [...prev, ...files]);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      setQueuedFiles(prev => [...prev, ...newFiles]);
    }
    e.target.value = '';
  }, []);

  const removeQueuedFile = useCallback((idx: number) => {
    setQueuedFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // === Upload + Build Dataset ===
  const handleUploadAndBuild = useCallback(async () => {
    if (!token || queuedFiles.length === 0) return;
    setUploading(true);
    setUploadStatus('Uploading files...');
    try {
      await trainingApi.uploadAudio(queuedFiles, uploadDatasetName, token);
      setUploadStatus(`Uploaded ${queuedFiles.length} files. Building dataset...`);
      const result = await trainingApi.buildDataset({
        datasetName: uploadDatasetName,
        customTag: datasetSettings.customTag,
        tagPosition: datasetSettings.tagPosition,
        allInstrumental: datasetSettings.allInstrumental,
      }, token);
      setDatasetLoaded(true);
      setSampleCount(result.sampleCount);
      setCurrentSampleIdx(0);
      if (result.sample) {
        setCurrentSample(result.sample);
        populateSampleFields(result.sample);
      }
      if (result.settings) setDatasetSettings(result.settings);
      if (result.dataframe) parseDataframe(result.dataframe);
      const dp = result.datasetPath || `./datasets/${uploadDatasetName}.json`;
      setDatasetPath(dp);
      setSavePath(dp);
      setDatasetStatus(result.status as string);
      setQueuedFiles([]);
      markStep('upload');
      setUploadStatus('Dataset built successfully!');
      // Auto-advance
      setTimeout(() => advanceToNext('upload'), 600);
    } catch (error) {
      setUploadStatus(`Error: ${error instanceof Error ? error.message : 'Upload failed'}`);
    } finally {
      setUploading(false);
    }
  }, [token, queuedFiles, uploadDatasetName, datasetSettings, markStep, advanceToNext]);

  // === Load existing dataset ===
  const handleLoadDataset = useCallback(async () => {
    if (!token || !datasetPath) return;
    setDatasetLoading(true);
    setDatasetStatus(t('loadingDataset'));
    try {
      const result = await trainingApi.loadDataset(datasetPath, token);
      setDatasetLoaded(true);
      setSampleCount(result.sampleCount);
      setCurrentSampleIdx(0);
      setCurrentSample(result.sample);
      populateSampleFields(result.sample);
      setDatasetSettings(result.settings);
      parseDataframe(result.dataframe);
      setDatasetStatus(result.status as string);
      setSavePath(datasetPath);
      markStep('upload');
      setUploadStatus('Dataset loaded!');
      setTimeout(() => advanceToNext('upload'), 600);
    } catch (error) {
      setDatasetStatus(`${t('error')}: ${error instanceof Error ? error.message : 'Failed'}`);
    } finally {
      setDatasetLoading(false);
    }
  }, [token, datasetPath, t, markStep, advanceToNext]);

  // === Auto-label (async with polling) ===
  const handleAutoLabel = useCallback(async () => {
    if (!token) return;
    setAutoLabeling(true);
    setAutoLabelStatus('Starting auto-label...');
    try {
      const startRes = await fetch('/api/training/auto-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ skipMetas, formatLyrics, transcribeLyrics, onlyUnlabeled }),
      });
      const result = await startRes.json();

      const taskId = result.task_id;
      if (!taskId) {
        setAutoLabelStatus(result.status || result.error || 'No task ID returned');
        setAutoLabeling(false);
        return;
      }

      const total = result.total || '?';
      setAutoLabelStatus(`Labeling samples... (0/${total})`);

      // Poll for progress
      const poll = async () => {
        for (let i = 0; i < 120; i++) { // max 10 min (5s * 120)
          await new Promise(r => setTimeout(r, 5000));
          try {
            const statusRes = await fetch('/api/training/auto-label-status', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!statusRes.ok) continue;
            const statusData = await statusRes.json();
            const s = statusData.data || statusData;

            if (s.status === 'completed' || s.status === 'success') {
              setAutoLabelStatus(`Done! Labeled ${s.current || s.total || 'all'} samples.`);
              // Refresh samples
              if (sampleCount > 0) {
                try {
                  const sample = await trainingApi.getSamplePreview(currentSampleIdx, token);
                  setCurrentSample(sample);
                  populateSampleFields(sample);
                } catch { /* ignore */ }
              }
              return;
            }

            if (s.status === 'failed') {
              setAutoLabelStatus(`Failed: ${s.error || 'Unknown error'}`);
              return;
            }

            // Still running
            setAutoLabelStatus(`Labeling samples... (${s.current || 0}/${s.total || '?'})`);
          } catch { /* ignore poll errors */ }
        }
        setAutoLabelStatus('Timed out waiting for auto-label');
      };
      await poll();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      setAutoLabelStatus(msg);
    } finally {
      setAutoLabeling(false);
    }
  }, [token, skipMetas, formatLyrics, transcribeLyrics, onlyUnlabeled, sampleCount, currentSampleIdx, t]);

  // === Sample navigation ===
  const handleSampleNavigate = useCallback(async (idx: number) => {
    if (!token || idx < 0 || idx >= sampleCount) return;
    setCurrentSampleIdx(idx);
    try {
      const sample = await trainingApi.getSamplePreview(idx, token);
      setCurrentSample(sample);
      populateSampleFields(sample);
    } catch (error) {
      console.error('Failed to load sample:', error);
    }
  }, [token, sampleCount]);

  // === Save sample ===
  const handleSaveSample = useCallback(async () => {
    if (!token) return;
    setSaving(true);
    try {
      const result = await trainingApi.saveSample({
        sampleIdx: currentSampleIdx,
        caption: editCaption,
        genre: editGenre,
        promptOverride: editPromptOverride,
        lyrics: editLyrics,
        bpm: editBpm,
        key: editKey,
        timeSignature: editTimeSig,
        language: editLanguage,
        instrumental: editInstrumental,
      }, token);
      if (result.dataframe) parseDataframe(result.dataframe);
      setEditSaveStatus(result.status as string);
    } catch (error) {
      setEditSaveStatus(`${t('error')}: ${error instanceof Error ? error.message : 'Failed'}`);
    } finally {
      setSaving(false);
    }
  }, [token, currentSampleIdx, editCaption, editGenre, editPromptOverride, editLyrics, editBpm, editKey, editTimeSig, editLanguage, editInstrumental, t]);

  // === Save dataset ===
  const handleSaveDataset = useCallback(async () => {
    if (!token) return;
    setSaving(true);
    setSaveStatus(t('savingDataset'));
    try {
      const result = await trainingApi.saveDataset({
        savePath: savePath || `./datasets/${datasetSettings.datasetName}.json`,
        datasetName: datasetSettings.datasetName,
        customTag: datasetSettings.customTag,
        tagPosition: datasetSettings.tagPosition,
        allInstrumental: datasetSettings.allInstrumental,
        genreRatio: datasetSettings.genreRatio,
      }, token);
      setSaveStatus(result.status as string);
      if (result.path) setSavePath(result.path);
      markStep('label');
      setTimeout(() => advanceToNext('label'), 600);
    } catch (error) {
      setSaveStatus(`${t('error')}: ${error instanceof Error ? error.message : 'Failed'}`);
    } finally {
      setSaving(false);
    }
  }, [token, savePath, datasetSettings, t, markStep, advanceToNext]);

  // === Preprocess ===
  const handlePreprocess = useCallback(async () => {
    if (!token) return;
    setPreprocessing(true);
    setPreprocessStatus('Starting preprocessing...');
    try {
      const startRes = await fetch('/api/training/preprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ datasetPath: savePath || datasetPath, outputDir: preprocessOutputDir }),
      });
      const result = await startRes.json();
      const taskId = result.task_id;

      if (!taskId) {
        setPreprocessStatus(result.status || result.error || 'No task ID returned');
        setPreprocessing(false);
        return;
      }

      setPreprocessStatus('Preprocessing audio samples...');

      // Poll for completion
      for (let i = 0; i < 360; i++) { // max 30 min
        await new Promise(r => setTimeout(r, 5000));
        try {
          const statusRes = await fetch('/api/training/preprocess-status', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!statusRes.ok) continue;
          const statusData = await statusRes.json();
          const s = statusData.data || statusData;

          if (s.status === 'completed' || s.status === 'success' || s.status === 'finished') {
            setPreprocessStatus('Preprocessing complete!');
            markStep('preprocess');
            setTimeout(() => advanceToNext('preprocess'), 600);
            return;
          }
          if (s.status === 'failed' || s.error) {
            setPreprocessStatus(`Failed: ${s.error || s.progress || 'Unknown error'}`);
            return;
          }
          // Still running
          setPreprocessStatus(s.progress || s.message || `Preprocessing... ${s.current || ''}/${s.total || '?'}`);
        } catch { /* ignore */ }
      }
      setPreprocessStatus('Timed out waiting for preprocessing');
    } catch (error) {
      setPreprocessStatus(`Error: ${error instanceof Error ? error.message : 'Preprocessing failed'}`);
    } finally {
      setPreprocessing(false);
    }
  }, [token, savePath, datasetPath, preprocessOutputDir, markStep, advanceToNext]);

  // === Load tensors ===
  const handleLoadTensors = useCallback(async () => {
    if (!token) return;
    try {
      const result = await trainingApi.loadTensors(trainingParams.tensorDir, token);
      setTrainingDatasetInfo(result.status);
    } catch (error) {
      setTrainingDatasetInfo(`Error: ${error instanceof Error ? error.message : 'Failed'}`);
    }
  }, [token, trainingParams.tensorDir]);

  // === Training ===
  const handleStartTraining = useCallback(async () => {
    if (!token) return;
    setIsTraining(true);
    setTrainingProgress('Starting training...');
    setTrainingLog('');
    setTrainingMetrics(null);
    try {
      await trainingApi.startTraining({
        ...trainingParams,
        resumeCheckpoint: trainingParams.resumeCheckpoint || null,
      }, token);

      // Poll training status
      for (let i = 0; i < 3600; i++) { // max 5 hours (5s * 3600)
        await new Promise(r => setTimeout(r, 5000));
        try {
          const statusRes = await fetch('/api/training/training-status', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!statusRes.ok) continue;
          const statusData = await statusRes.json();
          const s = statusData.data || statusData;

          const isDone = s.is_training === false || s.status === 'completed' || s.status === 'finished' || s.status === 'idle' || s.status === 'not_running' || (typeof s.status === 'string' && s.status.includes('complete'));
          const isFailed = s.status === 'failed' || s.status === 'error' || (typeof s.status === 'string' && s.status.includes('❌'));

          if (isFailed) {
            setTrainingProgress(`Training failed: ${s.error || s.status || 'Unknown error'}`);
            break;
          }
          if (isDone) {
            const finalLoss = s.current_loss || s.loss_history?.[s.loss_history.length - 1]?.loss;
            const doneMsg = typeof s.status === 'string' && s.status.includes('complete') ? s.status : 'Training complete!';
            setTrainingProgress(`${doneMsg}${finalLoss ? ` | Final loss: ${Number(finalLoss).toFixed(4)}` : ''}`);
            setTrainingLog('');
            markStep('train');
            break;
          }

          // Still running — show status from API (includes checkpoint saves, etc)
          const epoch = s.current_epoch ?? s.epoch ?? '?';
          const totalEpochs = s.total_epochs ?? trainingParams.epochs ?? '?';
          const loss = s.current_loss != null ? ` | Loss: ${Number(s.current_loss).toFixed(4)}` : '';
          const statusLine = s.status || `Training... Epoch ${epoch}/${totalEpochs}`;
          setTrainingProgress(`${statusLine}${loss}`);
          if (s.training_log && s.training_log !== 'Starting...') setTrainingLog(s.training_log);
        } catch { /* ignore poll errors */ }
      }
    } catch (error) {
      setTrainingProgress(`${t('error')}: ${error instanceof Error ? error.message : 'Failed'}`);
    } finally {
      setIsTraining(false);
    }
  }, [token, trainingParams, t, markStep]);

  const handleStopTraining = useCallback(async () => {
    if (!token) return;
    try {
      const result = await trainingApi.stopTraining(token);
      setTrainingProgress(result.status as string);
      setIsTraining(false);
    } catch (error) {
      console.error('Failed to stop training:', error);
    }
  }, [token]);

  // === Export ===
  const handleExportLora = useCallback(async () => {
    if (!token) return;
    setExporting(true);
    setExportStatus('Exporting...');
    try {
      const result = await trainingApi.exportLora({
        exportPath,
        loraOutputDir: exportOutputDir,
      }, token);
      setExportStatus(result.status as string);
      markStep('export');
    } catch (error) {
      setExportStatus(`${t('error')}: ${error instanceof Error ? error.message : 'Failed'}`);
    } finally {
      setExporting(false);
    }
  }, [token, exportPath, exportOutputDir, t, markStep]);

  // === Loss chart ===
  const lossChartSvg = useMemo(() => {
    if (!trainingMetrics) return null;
    let points: { step: number; loss: number }[] = [];
    const m = trainingMetrics as any;
    if (m?.data && Array.isArray(m.data)) {
      points = m.data.map((row: unknown[]) => ({ step: Number(row[0]) || 0, loss: Number(row[1]) || 0 })).filter((p: { loss: number }) => p.loss > 0);
    } else if (Array.isArray(m)) {
      points = m.map((item: any, i: number) => ({ step: item.step ?? item.x ?? i, loss: item.loss ?? item.y ?? 0 })).filter((p: { loss: number }) => p.loss > 0);
    }
    if (points.length < 2) return null;
    const width = 280, height = 100, pad = 4;
    const minStep = Math.min(...points.map(p => p.step));
    const maxStep = Math.max(...points.map(p => p.step));
    const minLoss = Math.min(...points.map(p => p.loss));
    const maxLoss = Math.max(...points.map(p => p.loss));
    const rangeStep = maxStep - minStep || 1;
    const rangeLoss = maxLoss - minLoss || 1;
    const polyPoints = points.map(p => {
      const x = pad + ((p.step - minStep) / rangeStep) * (width - 2 * pad);
      const y = pad + (1 - (p.loss - minLoss) / rangeLoss) * (height - 2 * pad);
      return `${x},${y}`;
    }).join(' ');
    return (
      <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`}>
        <polyline points={polyPoints} fill="none" stroke="rgb(236 72 153)" strokeWidth="1.5" strokeLinejoin="round" />
        <text x={pad} y={height - 2} fontSize="8" fill="rgb(113 113 122)" fontFamily="monospace">{minStep}</text>
        <text x={width - pad} y={height - 2} fontSize="8" fill="rgb(113 113 122)" fontFamily="monospace" textAnchor="end">{maxStep}</text>
        <text x={pad} y={10} fontSize="8" fill="rgb(113 113 122)" fontFamily="monospace">{minLoss.toFixed(4)}</text>
      </svg>
    );
  }, [trainingMetrics]);

  const activeStepIdx = PIPELINE_STEPS.findIndex(s => s.key === activeStep);

  return (
    <PageLayout title={t('loraTraining')} subtitle="Train a style adapter step by step">
      <div className="flex h-full min-h-0">
        {/* Left: Vertical Step Navigation */}
        <div className="w-[160px] flex-shrink-0 border-r border-zinc-800/50 pr-3 space-y-1 pt-1">
          {PIPELINE_STEPS.map((step, i) => {
            const Icon = step.icon;
            const done = completedSteps.has(step.key);
            const isCurrent = activeStep === step.key;
            const canClick = canGoToStep(step.key);
            return (
              <button
                key={step.key}
                onClick={() => goToStep(step.key)}
                disabled={!canClick}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-colors ${
                  isCurrent
                    ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20'
                    : done
                      ? 'text-zinc-400 hover:bg-white/5'
                      : canClick
                        ? 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                        : 'text-zinc-600 cursor-not-allowed'
                }`}
              >
                {done ? <Check size={12} className="text-green-500" /> : <Icon size={12} />}
                <span>{step.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Step Content */}
        <div className="flex-1 overflow-y-auto pl-4 space-y-2">

        {/* ===== STEP 1: UPLOAD ===== */}
        {activeStep === 'upload' && (
          <>
            <Section title="Upload Audio Files">
              <div
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${isDragOver ? 'border-pink-500 bg-pink-500/10' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'}`}
              >
                <Upload size={24} className={`mx-auto mb-1.5 ${isDragOver ? 'text-pink-400' : 'text-zinc-500'}`} />
                <p className="text-xs text-zinc-300 font-medium">Drop audio files here or click to browse</p>
                <p className="text-[11px] text-zinc-600 mt-1">.wav, .mp3, .flac, .ogg, .opus</p>
                <input ref={fileInputRef} type="file" multiple accept=".wav,.mp3,.flac,.ogg,.opus" onChange={handleFileSelect} className="hidden" />
              </div>
            </Section>

            {queuedFiles.length > 0 && (
              <Section title={`Queued Files (${queuedFiles.length})`}>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {queuedFiles.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-2 bg-white/5 rounded-lg px-2 py-1.5">
                      <FileAudio size={12} className="text-zinc-400 flex-shrink-0" />
                      <span className="text-[11px] text-zinc-300 truncate flex-1">{f.name}</span>
                      <span className="text-[10px] text-zinc-500">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                      <button onClick={() => removeQueuedFile(i)} className="text-zinc-500 hover:text-red-400"><X size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  <FieldRow label="Dataset Name">
                    <input type="text" value={uploadDatasetName} onChange={e => setUploadDatasetName(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500" placeholder="my_lora_dataset" />
                  </FieldRow>
                  <div className="flex justify-end pt-3 mt-3 border-t border-zinc-800/50">
                    <button onClick={handleUploadAndBuild} disabled={uploading || !uploadDatasetName.trim()} className="px-4 py-2 text-xs bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-medium flex items-center gap-2 disabled:opacity-50">
                      {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      Upload & Build Dataset ({queuedFiles.length} files)
                    </button>
                  </div>
                </div>
              </Section>
            )}

            {uploadStatus && (
              <div className={`px-3 py-2 rounded-lg text-xs ${uploadStatus.startsWith('Error') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                {uploadStatus}
              </div>
            )}

            {/* Or load existing */}
            <Section title="Or Load Existing Dataset">
              <div className="flex gap-2">
                <input type="text" value={datasetPath} onChange={e => setDatasetPath(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500" placeholder="./datasets/my_dataset.json" />
                <button onClick={handleLoadDataset} disabled={datasetLoading} className="px-3 py-1.5 bg-pink-500/20 hover:bg-pink-500/30 text-pink-400 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50">
                  {datasetLoading ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                  Load
                </button>
              </div>
              {datasetStatus && <p className="text-xs text-zinc-400 mt-1.5 break-words">{datasetStatus}</p>}
            </Section>
          </>
        )}

        {/* ===== STEP 2: LABEL & EDIT ===== */}
        {activeStep === 'label' && (
          <>
            {/* Model init status */}
            {(modelInitializing || modelInitStatus) && (
              <div className={`px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${modelInitializing ? 'bg-blue-500/10 text-blue-400' : modelInitStatus.includes('ready') || modelInitStatus.includes('Ready') ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                {modelInitializing && <Loader2 size={12} className="animate-spin" />}
                {modelInitStatus}
              </div>
            )}

            {/* Auto-Label */}
            <Section title="Auto-Label with AI">
              <p className="text-[11px] text-zinc-500 mb-2">Automatically label all samples with genre, BPM, key, and lyrics using the AI model.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
                <label className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <input type="checkbox" checked={skipMetas} onChange={e => setSkipMetas(e.target.checked)} className="w-3 h-3 accent-pink-500" />
                  Skip Metas
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <input type="checkbox" checked={formatLyrics} onChange={e => setFormatLyrics(e.target.checked)} className="w-3 h-3 accent-pink-500" />
                  Format Lyrics
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <input type="checkbox" checked={transcribeLyrics} onChange={e => setTranscribeLyrics(e.target.checked)} className="w-3 h-3 accent-pink-500" />
                  Transcribe Lyrics
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <input type="checkbox" checked={onlyUnlabeled} onChange={e => setOnlyUnlabeled(e.target.checked)} className="w-3 h-3 accent-pink-500" />
                  Only Unlabeled
                </label>
              </div>
              <div className="flex justify-end pt-3 mt-3 border-t border-zinc-800/50">
                <button onClick={handleAutoLabel} disabled={autoLabeling || modelInitializing} className="px-4 py-2 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-medium flex items-center gap-1.5 border border-zinc-700 disabled:opacity-50">
                  {autoLabeling ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  Auto-Label All Samples
                </button>
              </div>
              {autoLabelStatus && <p className="text-xs text-zinc-400 mt-1.5 break-words">{autoLabelStatus}</p>}
            </Section>

            {/* Dataset Table */}
            {dataframeRows.length > 0 && (
              <Section title={`Samples (${dataframeRows.length})`}>
                <div className="overflow-x-auto max-h-36 overflow-y-auto rounded-lg border border-white/5">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="bg-white/5 sticky top-0">
                        <th className="text-left px-2 py-1 text-zinc-400 font-medium">#</th>
                        {dataframeHeaders.slice(0, 5).map(h => (
                          <th key={h} className="text-left px-2 py-1 text-zinc-400 font-medium truncate max-w-[80px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dataframeRows.map((row, i) => (
                        <tr key={i} onClick={() => handleSampleNavigate(i)} className={`cursor-pointer transition-colors ${i === currentSampleIdx ? 'bg-pink-500/10 text-pink-300' : 'hover:bg-white/5 text-zinc-300'}`}>
                          <td className="px-2 py-0.5 text-zinc-500">{i + 1}</td>
                          {dataframeHeaders.slice(0, 5).map(h => (
                            <td key={h} className="px-2 py-0.5 truncate max-w-[80px]">{String(row[h] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Sample Editor */}
            {sampleCount > 0 && (
              <Section title={`Edit Sample (${currentSampleIdx + 1}/${sampleCount})`}>
                <div className="flex items-center gap-2 mb-2">
                  <button onClick={() => handleSampleNavigate(currentSampleIdx - 1)} disabled={currentSampleIdx <= 0} className="px-2 py-1 bg-white/5 hover:bg-white/10 text-zinc-300 rounded text-xs disabled:opacity-30">Prev</button>
                  <input type="number" min={1} max={sampleCount} value={currentSampleIdx + 1} onChange={e => { const v = parseInt(e.target.value) - 1; if (v >= 0 && v < sampleCount) handleSampleNavigate(v); }} className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-center text-zinc-200" />
                  <button onClick={() => handleSampleNavigate(currentSampleIdx + 1)} disabled={currentSampleIdx >= sampleCount - 1} className="px-2 py-1 bg-white/5 hover:bg-white/10 text-zinc-300 rounded text-xs disabled:opacity-30">Next</button>
                  <span className="text-[10px] text-zinc-500 ml-auto truncate max-w-[100px]">{currentSample?.filename || ''}</span>
                </div>

                {audioPreviewUrl && (
                  <div className="mb-2 flex items-center gap-2 bg-white/5 rounded-lg px-2 py-1.5">
                    <Volume2 size={14} className="text-pink-400 flex-shrink-0" />
                    <audio controls src={audioPreviewUrl} className="w-full h-7 [&::-webkit-media-controls-panel]:bg-transparent" preload="metadata" />
                  </div>
                )}

                <div className="space-y-3">
                  {/* Row 1: Caption + Genre side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Caption</label>
                      <input type="text" value={editCaption} onChange={e => setEditCaption(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Genre</label>
                      <input type="text" value={editGenre} onChange={e => setEditGenre(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500" />
                    </div>
                  </div>
                  {/* Row 2: Lyrics (full width, shorter) */}
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Lyrics</label>
                    <textarea value={editLyrics} onChange={e => setEditLyrics(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500 resize-none h-16" />
                  </div>
                  {/* Row 3: BPM + Key + Language in 3 columns */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">BPM</label>
                      <input type="number" value={editBpm} onChange={e => setEditBpm(parseInt(e.target.value) || 0)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Key</label>
                      <input type="text" value={editKey} onChange={e => setEditKey(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Language</label>
                      <select value={editLanguage} onChange={e => setEditLanguage(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500">
                        {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-3 mt-3 border-t border-zinc-800/50">
                    <button onClick={handleSaveSample} disabled={saving} className="px-4 py-2 text-xs bg-pink-500/20 hover:bg-pink-500/30 text-pink-400 rounded-lg font-medium flex items-center gap-1.5 disabled:opacity-50">
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Edit3 size={14} />}
                      Save Sample
                    </button>
                  </div>
                  {editSaveStatus && <p className="text-xs text-zinc-400 mt-1 break-words">{editSaveStatus}</p>}
                </div>
              </Section>
            )}

            {/* Save Dataset & Advance — only show after samples exist */}
            {sampleCount > 0 && <Section title="Save Dataset">
              <FieldRow label="Save Path">
                <input type="text" value={savePath} onChange={e => setSavePath(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500" />
              </FieldRow>
              <div className="flex justify-end pt-3 mt-3 border-t border-zinc-800/50">
                <button onClick={handleSaveDataset} disabled={saving} className="px-4 py-2 text-xs bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-medium flex items-center gap-1.5 disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Dataset & Continue
                </button>
              </div>
              {saveStatus && <p className="text-xs text-zinc-400 mt-1.5 break-words">{saveStatus}</p>}
            </Section>}
          </>
        )}

        {/* ===== STEP 3: PREPROCESS ===== */}
        {activeStep === 'preprocess' && (
          <>
            <div className="max-w-lg">
              <Section title="Preprocess to Tensors">
                <p className="text-[11px] text-zinc-500 mb-3">Convert your labeled dataset into training-ready tensors.</p>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Dataset</label>
                    <div className="text-xs text-zinc-300 truncate bg-zinc-900/50 rounded-lg px-3 py-1.5 border border-zinc-800">{savePath || datasetPath}</div>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Output Dir</label>
                    <input type="text" value={preprocessOutputDir} onChange={e => setPreprocessOutputDir(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500" />
                  </div>
                </div>
                <div className="flex justify-end pt-3 mt-3 border-t border-zinc-800/50">
                  <button onClick={handlePreprocess} disabled={preprocessing} className="px-4 py-2 text-xs bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-medium flex items-center gap-1.5 disabled:opacity-50">
                    {preprocessing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    {preprocessing ? 'Preprocessing...' : 'Start Preprocessing'}
                  </button>
                </div>
                {preprocessStatus && (
                  <div className={`mt-2 px-3 py-2 rounded-lg text-xs ${preprocessStatus.startsWith('Error') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                    {preprocessStatus}
                  </div>
                )}
              </Section>
            </div>
          </>
        )}

        {/* ===== STEP 4: TRAIN ===== */}
        {activeStep === 'train' && (
          <>
            {/* Load Tensors */}
            <Section title="Preprocessed Dataset">
              <div className="flex gap-2">
                <input type="text" value={trainingParams.tensorDir} onChange={e => setTrainingParams(p => ({ ...p, tensorDir: e.target.value }))} className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500" />
                <button onClick={handleLoadTensors} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-1.5 border border-zinc-700">
                  <FolderOpen size={14} />
                  Load
                </button>
              </div>
              {trainingDatasetInfo && <p className="text-xs text-zinc-400 mt-1.5 break-words whitespace-pre-wrap">{trainingDatasetInfo}</p>}
            </Section>

            {/* LoRA Settings — 3 columns */}
            <Section title="LoRA Settings">
              <div className="grid grid-cols-3 gap-3">
                <CompactSlider label="Rank (r)" value={trainingParams.rank} min={4} max={256} step={4} onChange={v => setTrainingParams(p => ({ ...p, rank: v }))} />
                <CompactSlider label="Alpha (a)" value={trainingParams.alpha} min={4} max={512} step={4} onChange={v => setTrainingParams(p => ({ ...p, alpha: v }))} />
                <CompactSlider label="Dropout" value={trainingParams.dropout} min={0} max={0.5} step={0.05} onChange={v => setTrainingParams(p => ({ ...p, dropout: v }))} />
              </div>
            </Section>

            {/* Training Parameters — grid */}
            <Section title="Training Parameters">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Learning Rate</label>
                  <input type="number" value={trainingParams.learningRate} onChange={e => setTrainingParams(p => ({ ...p, learningRate: parseFloat(e.target.value) || 0.0003 }))} step={0.0001} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500" />
                </div>
                <CompactSlider label="Max Epochs" value={trainingParams.epochs} min={1} max={4000} step={1} onChange={v => setTrainingParams(p => ({ ...p, epochs: v }))} />
                <CompactSlider label="Batch Size" value={trainingParams.batchSize} min={1} max={8} step={1} onChange={v => setTrainingParams(p => ({ ...p, batchSize: v }))} />
                <CompactSlider label="Gradient Accum." value={trainingParams.gradientAccumulation} min={1} max={16} step={1} onChange={v => setTrainingParams(p => ({ ...p, gradientAccumulation: v }))} />
                <CompactSlider label="Save Every (epochs)" value={trainingParams.saveEvery} min={50} max={1000} step={50} onChange={v => setTrainingParams(p => ({ ...p, saveEvery: v }))} />
              </div>
            </Section>

            {/* Output — 2 columns */}
            <Section title="Output">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Output Dir</label>
                  <input type="text" value={trainingParams.outputDir} onChange={e => setTrainingParams(p => ({ ...p, outputDir: e.target.value }))} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500" />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Resume Checkpoint</label>
                  <input type="text" value={trainingParams.resumeCheckpoint} onChange={e => setTrainingParams(p => ({ ...p, resumeCheckpoint: e.target.value }))} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500" placeholder="./lora_output/checkpoints/epoch_200" />
                </div>
              </div>
            </Section>

            {/* Training Controls */}
            <div className="flex justify-end pt-3 mt-3 border-t border-zinc-800/50">
              {!isTraining ? (
                <button onClick={handleStartTraining} className="px-4 py-2 text-xs bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-medium flex items-center gap-2">
                  <Play size={16} />
                  Start Training
                </button>
              ) : (
                <button onClick={handleStopTraining} className="px-4 py-2 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium flex items-center gap-2">
                  <Square size={16} />
                  Stop Training
                </button>
              )}
            </div>

            {/* Training Progress */}
            {(trainingProgress || trainingLog) && (
              <Section title="Training Progress">
                {trainingProgress && <p className="text-xs text-zinc-300 mb-2 break-words">{trainingProgress}</p>}
                {trainingLog && (
                  <pre className="text-[10px] text-zinc-400 bg-black/20 rounded-lg p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">{trainingLog}</pre>
                )}
              </Section>
            )}

            {/* Loss Chart */}
            {lossChartSvg && (
              <Section title="Training Loss">
                <div className="bg-black/20 rounded-lg p-2">{lossChartSvg}</div>
              </Section>
            )}
          </>
        )}

        {/* ===== STEP 5: EXPORT ===== */}
        {activeStep === 'export' && (
          <>
            <Section title="Export LoRA">
              <p className="text-[11px] text-zinc-500 mb-3">Export your trained LoRA adapter for use in generation.</p>
              <div className="space-y-2">
                <FieldRow label="Export Path">
                  <input type="text" value={exportPath} onChange={e => setExportPath(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500" />
                </FieldRow>
                <FieldRow label="LoRA Output Dir">
                  <input type="text" value={exportOutputDir} onChange={e => setExportOutputDir(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500" />
                </FieldRow>
              </div>
              <div className="flex justify-end pt-3 mt-3 border-t border-zinc-800/50">
                <button onClick={handleExportLora} disabled={exporting} className="px-4 py-2 text-xs bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-medium flex items-center gap-2 disabled:opacity-50">
                  {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Export LoRA
                </button>
              </div>
              {exportStatus && (
                <div className={`mt-2 px-3 py-2 rounded-lg text-xs ${exportStatus.startsWith('Error') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                  {exportStatus}
                </div>
              )}
            </Section>

            {completedSteps.has('export') && (
              <Section title="Next Steps">
                <p className="text-xs text-zinc-400">
                  Your LoRA adapter has been exported. Go to the Create page and open the LoRA section to load it at:
                </p>
                <p className="text-xs text-pink-400 font-mono mt-1">{exportPath}/adapter</p>
              </Section>
            )}
          </>
        )}
        </div>
      </div>
    </PageLayout>
  );
};

// Reusable Section component
const Section: React.FC<{ title: string | React.ReactNode; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white dark:bg-suno-card rounded-xl border border-zinc-200 dark:border-white/5">
    <div className="px-3 py-2 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl">
      <h3 className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{title}</h3>
    </div>
    <div className="p-3">{children}</div>
  </div>
);

const FieldRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-2">
    <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 w-28 flex-shrink-0">{label}</label>
    {children}
  </div>
);

const ParamSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, onChange }) => (
  <div>
    <div className="flex items-center justify-between mb-0.5">
      <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</label>
      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">{step < 1 ? value.toFixed(2) : value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-pink-500 h-1" />
  </div>
);

const CompactSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, onChange }) => (
  <div className="bg-zinc-900/50 rounded-lg p-2.5">
    <div className="flex items-center justify-between mb-1">
      <label className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</label>
      <span className="text-[10px] text-zinc-400 font-mono">{step < 1 ? value.toFixed(2) : value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-pink-500 h-1" />
  </div>
);
