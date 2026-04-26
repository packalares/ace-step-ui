import { randomUUID } from 'crypto';

export type TtsJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TtsJobResult {
  audioUrl: string;
  durationSeconds: number;
}

export interface TtsJob {
  id: string;
  status: TtsJobStatus;
  progress: number; // 0..1, best-effort
  log: string[];
  result?: TtsJobResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const MAX_LOG_LINES = 200;
const MAX_AGE_MS = 1000 * 60 * 60 * 6; // 6h sweep

const jobs = new Map<string, TtsJob>();

function sweep(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff && (job.status === 'completed' || job.status === 'failed')) {
      jobs.delete(id);
    }
  }
}

export function createJob(): TtsJob {
  sweep();
  const now = Date.now();
  const job: TtsJob = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    log: [],
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): TtsJob | undefined {
  return jobs.get(id);
}

type Patch = Partial<Omit<TtsJob, 'id' | 'createdAt' | 'log'>> & {
  appendLog?: string;
};

export function updateJob(id: string, patch: Patch): TtsJob | undefined {
  const existing = jobs.get(id);
  if (!existing) return undefined;
  const next: TtsJob = { ...existing, updatedAt: Date.now() };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.progress !== undefined) next.progress = patch.progress;
  if (patch.result !== undefined) next.result = patch.result;
  if (patch.error !== undefined) next.error = patch.error;
  if (patch.appendLog) {
    const line = patch.appendLog.length > 1000 ? patch.appendLog.slice(0, 1000) + '…' : patch.appendLog;
    const log = [...existing.log, line];
    if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES);
    next.log = log;
  }
  jobs.set(id, next);
  return next;
}
