import React, { useEffect, useRef, useState } from 'react';
import { X, Download, Loader2, Music2, AlertTriangle, Check } from 'lucide-react';
import { stemsApi, StemJob, StemFile } from '../services/api';
import { useAuth } from '../context/AuthContext';

// ---------------------------------------------------------------------------
// Replaces the browser-side Demucs popup that lived under /demucs-web/.
//
// Usage: trigger from anywhere via:
//   window.dispatchEvent(new CustomEvent('songstudio:extract-stems', {
//     detail: { songId, songTitle, model? }
//   }));
//
// Mounted once at the App level; listens for the event and runs the modal.
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'htdemucs_6s.yaml';
const POLL_INTERVAL_MS = 2000;

interface ExtractRequest {
  songId: string;
  songTitle?: string;
  model?: string;
}

export const StemExtractionModal: React.FC = () => {
  const { token } = useAuth();
  const [target, setTarget] = useState<ExtractRequest | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<StemJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Listen for the global trigger event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ExtractRequest>).detail;
      if (!detail?.songId) return;
      setTarget(detail);
      setJob(null);
      setJobId(null);
      setError(null);
    };
    window.addEventListener('songstudio:extract-stems', handler as EventListener);
    return () => window.removeEventListener('songstudio:extract-stems', handler as EventListener);
  }, []);

  // Auto-start when a target lands.
  useEffect(() => {
    if (!target || !token || jobId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await stemsApi.extractForSong(
          target.songId,
          target.model ?? DEFAULT_MODEL,
          token,
        );
        if (cancelled) return;
        setJobId(res.jobId);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, token, jobId]);

  // Poll status until terminal.
  useEffect(() => {
    if (!target || !jobId || !token) return;
    const tick = async () => {
      try {
        const next = await stemsApi.songStatus(target.songId, jobId, token);
        setJob(next);
        if (next.status === 'completed' || next.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    void tick();
    pollRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [target, jobId, token]);

  const onClose = () => {
    setTarget(null);
    setJob(null);
    setJobId(null);
    setError(null);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  if (!target) return null;

  const stems: StemFile[] = job?.result?.outputs?.[0]?.stems ?? [];
  const isRunning = job?.status === 'running' || job?.status === 'queued' || (!job && !error);
  const isFailed = job?.status === 'failed' || error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md mx-4 p-6 shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Music2 size={18} className="text-emerald-400" />
              Extract Stems
            </h3>
            {target.songTitle && (
              <p className="text-xs text-zinc-500 mt-1 truncate max-w-[280px]">{target.songTitle}</p>
            )}
            <p className="text-xs text-zinc-600 mt-1">
              Model: {target.model ?? DEFAULT_MODEL}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-white rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {isRunning && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <Loader2 size={16} className="animate-spin text-emerald-400" />
              <span>{job?.status === 'queued' ? 'Queued…' : 'Separating…'}</span>
              {job && <span className="ml-auto text-xs text-zinc-500">{job.progress}%</span>}
            </div>
            {job && (
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            )}
            {job?.log?.length ? (
              <div className="text-[11px] text-zinc-600 font-mono leading-tight max-h-20 overflow-hidden">
                {job.log[job.log.length - 1]}
              </div>
            ) : null}
          </div>
        )}

        {isFailed && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-red-400">
              <AlertTriangle size={16} />
              <span>Extraction failed</span>
            </div>
            <p className="text-xs text-zinc-500 break-words">{error ?? job?.error}</p>
          </div>
        )}

        {job?.status === 'completed' && stems.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <Check size={16} />
              <span>{stems.length} stems ready</span>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {stems.map((s) => (
                <a
                  key={s.path}
                  href={s.url ?? s.path}
                  download
                  className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-800/60 hover:bg-zinc-800 rounded-lg text-sm text-zinc-200 transition-colors"
                >
                  <span className="truncate">{s.name}</span>
                  <Download size={14} className="text-zinc-500 flex-shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
