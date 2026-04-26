import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic2, Upload, X, Play, Pause, Loader2, Download, Save, RotateCcw,
  ChevronDown, ChevronRight, Sparkles, Dice5, Music2,
} from 'lucide-react';
import { PageLayout, Card, CardHeader, Button, Toggle } from './ui';
import { useAuth } from '../context/AuthContext';
import { ttsApi, songsApi, TtsJob } from '../services/api';

const REF_VOICE_META_KEY = 'tts:lastRefVoiceMeta';
const POLL_INTERVAL_MS = 1500;
const MAX_TEXT = 5000;

type EmotionMode = 'none' | 'audio' | 'text' | 'vector';

interface RefVoiceMeta {
  filename: string;
  size: number;
  type: string;
  lastUsedAt: number;
}

const EMOTION_LABELS = ['Happy', 'Angry', 'Sad', 'Afraid', 'Disgust', 'Sad-Low', 'Surprise', 'Calm'];

export const TTSPanel: React.FC = () => {
  const { token } = useAuth();

  // Reference voice state
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refUrl, setRefUrl] = useState<string | null>(null);
  const [refMeta, setRefMeta] = useState<RefVoiceMeta | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  // Text
  const [text, setText] = useState('');

  // Emotion controls
  const [emotionExpanded, setEmotionExpanded] = useState(false);
  const [emoMode, setEmoMode] = useState<EmotionMode>('none');
  const [emoFile, setEmoFile] = useState<File | null>(null);
  const [emoText, setEmoText] = useState('');
  const [emoVector, setEmoVector] = useState<number[]>(() => Array(8).fill(0));
  const [emoAlpha, setEmoAlpha] = useState(1.0);
  const emoInputRef = useRef<HTMLInputElement>(null);

  // Advanced
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [fp16, setFp16] = useState(true);
  const [seed, setSeed] = useState<string>('');
  const [randomSeed, setRandomSeed] = useState(true);
  const [intervalSilence, setIntervalSilence] = useState(200);

  // Job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<TtsJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [savedSongId, setSavedSongId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Player
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const refPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [resultPlaying, setResultPlaying] = useState(false);

  // Restore last used ref-voice metadata (not the file itself)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(REF_VOICE_META_KEY);
      if (raw) setRefMeta(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Cleanup blob URLs and polling interval on unmount
  useEffect(() => {
    return () => {
      if (refUrl) URL.revokeObjectURL(refUrl);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refUrl]);

  const handleRefFileSelected = useCallback((file: File) => {
    if (refUrl) URL.revokeObjectURL(refUrl);
    setRefFile(file);
    const url = URL.createObjectURL(file);
    setRefUrl(url);
    const meta: RefVoiceMeta = {
      filename: file.name,
      size: file.size,
      type: file.type,
      lastUsedAt: Date.now(),
    };
    setRefMeta(meta);
    try { localStorage.setItem(REF_VOICE_META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
  }, [refUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      handleRefFileSelected(file);
    }
  }, [handleRefFileSelected]);

  const clearRef = () => {
    if (refUrl) URL.revokeObjectURL(refUrl);
    setRefFile(null);
    setRefUrl(null);
    if (refInputRef.current) refInputRef.current.value = '';
  };

  const updateEmoVector = (idx: number, value: number) => {
    setEmoVector((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const emoVectorSum = useMemo(() => emoVector.reduce((a, b) => a + b, 0), [emoVector]);

  const generateRandomSeed = () => {
    setSeed(String(Math.floor(Math.random() * 2 ** 31)));
  };

  const canGenerate = !!refFile && text.trim().length > 0 && !submitting && job?.status !== 'running';

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (!token) return;
      try {
        const j = await ttsApi.status(id, token);
        setJob(j);
        if (j.status === 'completed' || j.status === 'failed') {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (j.status === 'failed') setErrorMsg(j.error || 'Generation failed');
        }
      } catch (err) {
        console.error('TTS status poll error:', err);
      }
    }, POLL_INTERVAL_MS);
  }, [token]);

  const handleGenerate = async () => {
    if (!token || !refFile || !text.trim()) return;
    setErrorMsg(null);
    setSavedSongId(null);
    setJob(null);
    setSubmitting(true);

    try {
      const form = new FormData();
      form.append('refAudio', refFile);
      form.append('text', text.trim());
      if (emoMode === 'audio' && emoFile) {
        form.append('emoAudio', emoFile);
      }
      if (emoMode === 'text' && emoText.trim()) {
        form.append('emoText', emoText.trim());
      }
      if (emoMode === 'vector') {
        form.append('emoVector', JSON.stringify(emoVector));
      }
      if (emoMode !== 'none') {
        form.append('emoAlpha', String(emoAlpha));
      }
      form.append('fp16', String(fp16));
      if (!randomSeed && seed.trim()) form.append('seed', seed.trim());
      form.append('intervalSilence', String(intervalSilence));

      const { jobId: id } = await ttsApi.clone(form, token);
      setJobId(id);
      // Seed local job state immediately so the UI flips to running.
      setJob({
        id,
        status: 'running',
        progress: 0.05,
        log: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      startPolling(id);
    } catch (err) {
      console.error('TTS clone error:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setJob(null);
    setJobId(null);
    setErrorMsg(null);
    setSavedSongId(null);
    setResultPlaying(false);
  };

  const toggleResultPlay = () => {
    const audio = playerRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => { /* ignore */ });
      setResultPlaying(true);
    } else {
      audio.pause();
      setResultPlaying(false);
    }
  };

  useEffect(() => {
    const audio = playerRef.current;
    if (!audio) return;
    const onEnd = () => setResultPlaying(false);
    audio.addEventListener('ended', onEnd);
    return () => audio.removeEventListener('ended', onEnd);
  }, [job?.result?.audioUrl]);

  const downloadResult = () => {
    const url = job?.result?.audioUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `tts-${jobId ?? 'output'}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const saveToLibrary = async () => {
    if (!token || !job?.result?.audioUrl) return;
    setSavingToLibrary(true);
    try {
      const titleSource = text.trim().slice(0, 40) || 'Voice clone';
      const title = titleSource + (text.trim().length > 40 ? '…' : '');
      // Server's POST /api/songs reads camelCase fields (audioUrl, isPublic, etc.)
      const result = await songsApi.createSong({
        title,
        lyrics: text.trim(),
        style: 'TTS / Voice Clone',
        caption: 'Generated with IndexTTS2',
        audioUrl: job.result.audioUrl,
        duration: job.result.durationSeconds,
        tags: ['tts'],
        isPublic: false,
      } as any, token);
      setSavedSongId(result.song.id);
    } catch (err) {
      console.error('Save to library failed:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save to library');
    } finally {
      setSavingToLibrary(false);
    }
  };

  const charCount = text.length;
  const charsOver = charCount > MAX_TEXT;
  const lastLog = job?.log?.[job.log.length - 1];
  const progressPct = Math.max(0, Math.min(100, Math.round((job?.progress ?? 0) * 100)));
  const isRunning = job?.status === 'running' || job?.status === 'queued';
  const isDone = job?.status === 'completed' && !!job.result?.audioUrl;

  return (
    <PageLayout
      title="Voice Clone (TTS)"
      subtitle="Clone any voice from a short reference clip and generate spoken text with IndexTTS2."
    >
      <div className="max-w-3xl mx-auto py-3 space-y-4">
        {/* Reference voice */}
        <Card>
          <CardHeader title="Reference voice" subtitle="5–15s of clean speech in the target voice works best." />
          <div className="p-3">
            {!refFile ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => refInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-pink-500 bg-pink-500/5'
                    : 'border-zinc-200 dark:border-white/10 hover:border-pink-500/40 dark:hover:border-pink-500/40'
                }`}
              >
                <Upload size={20} className="text-zinc-400" />
                <span className="text-[12px] text-zinc-700 dark:text-zinc-300">Drop an audio file or click to upload</span>
                <span className="text-[10px] text-zinc-500">mp3, wav, flac, m4a, ogg — up to 25 MB</span>
                {refMeta && (
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1">
                    Last used: {refMeta.filename}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-white/5 rounded-xl">
                <Mic2 size={18} className="text-pink-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">{refFile.name}</div>
                  <div className="text-[10px] text-zinc-500">{(refFile.size / 1024).toFixed(1)} KB</div>
                  {refUrl && (
                    <audio ref={refPreviewRef} src={refUrl} controls className="mt-2 w-full h-8" />
                  )}
                </div>
                <button
                  onClick={clearRef}
                  className="p-1.5 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  title="Remove"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <input
              ref={refInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleRefFileSelected(f);
              }}
            />
          </div>
        </Card>

        {/* Text */}
        <Card>
          <CardHeader title="Text to speak" subtitle={`${charCount} / ${MAX_TEXT} characters`} />
          <div className="p-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type or paste the text you want spoken in the cloned voice…"
              rows={6}
              className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-pink-500 resize-y transition-colors"
            />
            {charsOver && (
              <p className="mt-1 text-[10px] text-red-500">Text exceeds {MAX_TEXT} character recommended limit.</p>
            )}
          </div>
        </Card>

        {/* Emotion */}
        <Card>
          <button
            onClick={() => setEmotionExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl text-left"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={12} className="text-pink-500" />
              <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Emotion</span>
              {emoMode !== 'none' && (
                <span className="text-[9px] font-bold uppercase tracking-wide text-pink-500">{emoMode}</span>
              )}
            </div>
            {emotionExpanded ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
          </button>
          {emotionExpanded && (
            <div className="p-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                {(['none', 'audio', 'text', 'vector'] as EmotionMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setEmoMode(mode)}
                    className={`text-[10px] font-medium px-3 py-1.5 rounded-full border transition-colors ${
                      emoMode === mode
                        ? 'bg-pink-600 text-white border-pink-500 shadow-sm'
                        : 'bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-white/5'
                    }`}
                  >
                    {mode === 'none' ? 'No emotion' : mode === 'audio' ? 'From audio' : mode === 'text' ? 'From text' : 'Manual vector'}
                  </button>
                ))}
              </div>

              {emoMode === 'audio' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => emoInputRef.current?.click()}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-white/10"
                  >
                    {emoFile ? 'Replace file' : 'Choose emotion audio'}
                  </button>
                  {emoFile && (
                    <span className="text-[11px] text-zinc-500 truncate flex-1">{emoFile.name}</span>
                  )}
                  <input
                    ref={emoInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => setEmoFile(e.target.files?.[0] || null)}
                  />
                </div>
              )}

              {emoMode === 'text' && (
                <input
                  type="text"
                  value={emoText}
                  onChange={(e) => setEmoText(e.target.value)}
                  placeholder="e.g. excited and slightly nervous"
                  className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500"
                />
              )}

              {emoMode === 'vector' && (
                <div className="space-y-2">
                  {EMOTION_LABELS.map((label, idx) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 w-16 truncate">{label}</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={emoVector[idx]}
                        onChange={(e) => updateEmoVector(idx, Number(e.target.value))}
                        className="flex-1 accent-pink-500"
                      />
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 w-8 text-right tabular-nums">
                        {emoVector[idx].toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <p className={`text-[10px] ${emoVectorSum > 1.5 ? 'text-amber-500' : 'text-zinc-500'}`}>
                    Sum: {emoVectorSum.toFixed(2)} (recommend ≤ 1.5)
                  </p>
                </div>
              )}

              {emoMode !== 'none' && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 w-24">Strength</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={emoAlpha}
                    onChange={(e) => setEmoAlpha(Number(e.target.value))}
                    className="flex-1 accent-pink-500"
                  />
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 w-10 text-right tabular-nums">
                    {emoAlpha.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Advanced */}
        <Card>
          <button
            onClick={() => setAdvancedExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-white/5 border-b border-zinc-100 dark:border-white/5 rounded-t-xl text-left"
          >
            <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Advanced</span>
            {advancedExpanded ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
          </button>
          {advancedExpanded && (
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between py-1">
                <div>
                  <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">FP16</span>
                  <p className="text-[10px] text-zinc-400">Faster inference, slightly lower precision.</p>
                </div>
                <Toggle checked={fp16} onChange={() => setFp16((v) => !v)} />
              </div>
              <div className="flex items-center justify-between py-1 gap-3">
                <div className="flex-1">
                  <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Seed</span>
                  <p className="text-[10px] text-zinc-400">Deterministic output. Random if blank.</p>
                </div>
                <Toggle checked={randomSeed} onChange={() => setRandomSeed((v) => !v)} />
                <input
                  type="number"
                  value={seed}
                  disabled={randomSeed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="auto"
                  className="w-24 bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1 text-[11px] text-zinc-900 dark:text-white focus:outline-none focus:border-pink-500 disabled:opacity-40"
                />
                <button
                  onClick={generateRandomSeed}
                  disabled={randomSeed}
                  className="p-1.5 rounded-md text-zinc-500 hover:text-pink-500 hover:bg-pink-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Roll a seed"
                >
                  <Dice5 size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2 py-1">
                <div className="flex-1">
                  <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Sentence pause</span>
                  <p className="text-[10px] text-zinc-400">Silence between sentences (ms).</p>
                </div>
                <input
                  type="range"
                  min={50}
                  max={1000}
                  step={10}
                  value={intervalSilence}
                  onChange={(e) => setIntervalSilence(Number(e.target.value))}
                  className="flex-1 accent-pink-500"
                />
                <span className="text-[10px] text-zinc-500 w-12 text-right tabular-nums">{intervalSilence}ms</span>
              </div>
            </div>
          )}
        </Card>

        {/* Generate / Result */}
        <Card>
          <div className="p-3 space-y-3">
            {!isDone && (
              <Button
                variant="primary"
                size="md"
                onClick={handleGenerate}
                disabled={!canGenerate}
                loading={submitting || isRunning}
                className="w-full"
              >
                {isRunning ? 'Generating…' : <>
                  <Mic2 size={14} />
                  <span>Generate speech</span>
                </>}
              </Button>
            )}

            {isRunning && (
              <div className="space-y-2">
                <div className="h-1.5 w-full bg-zinc-100 dark:bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <Loader2 size={10} className="animate-spin text-pink-500" />
                  <span className="truncate">{lastLog || 'Running IndexTTS2…'}</span>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="text-[11px] text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {errorMsg}
              </div>
            )}

            {isDone && job?.result?.audioUrl && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-white/5 rounded-xl">
                  <button
                    onClick={toggleResultPlay}
                    className="w-10 h-10 rounded-full bg-pink-600 hover:bg-pink-700 flex items-center justify-center text-white shadow-md flex-shrink-0"
                  >
                    {resultPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">
                      {text.trim().slice(0, 60) || 'Generated voice'}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {job.result.durationSeconds > 0 ? `${job.result.durationSeconds.toFixed(2)}s` : 'audio ready'}
                    </div>
                  </div>
                  <audio
                    ref={playerRef}
                    src={job.result.audioUrl}
                    onPause={() => setResultPlaying(false)}
                    onPlay={() => setResultPlaying(true)}
                    className="hidden"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={saveToLibrary} loading={savingToLibrary} disabled={!!savedSongId}>
                    {savedSongId ? <><Save size={12} /> Saved</> : <><Save size={12} /> Save to library</>}
                  </Button>
                  <Button onClick={downloadResult}>
                    <Download size={12} />
                    Download
                  </Button>
                  <Button variant="ghost" onClick={resetForm}>
                    <RotateCcw size={12} />
                    Generate again
                  </Button>
                  {savedSongId && (
                    <span className="text-[10px] text-emerald-500 self-center inline-flex items-center gap-1">
                      <Music2 size={10} />
                      Added to your library
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </PageLayout>
  );
};
