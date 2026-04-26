/**
 * In-memory stem-extraction job tracker.
 *
 * Mirrors the AutoLabelTask pattern from ACE-Step's FastAPI
 * (`acestep/api/train_api_dataset_models.py` → `AutoLabelTask`):
 * we track status, progress, and a tail of log lines per job.
 *
 * Used by:
 *   - server/src/routes/training.ts → POST /api/training/preprocess-stems
 *   - server/src/routes/songs.ts    → POST /api/songs/:id/extract-stems
 *
 * TODO: add TTL eviction. Right now the Map grows unbounded for the
 *       lifetime of the Express process. Acceptable for local single-user
 *       app, but should be revisited when we add auth/multi-tenant support.
 */
import { randomUUID } from 'crypto';
import type { SeparateResult } from './audioSeparator.js';

const MAX_LOG_LINES = 200;

export interface StemJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;       // 0-100
  current: number;        // file index (0-based count of completed inputs)
  total: number;
  log: string[];
  result?: SeparateResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const jobs = new Map<string, StemJob>();

export function createJob(total: number): StemJob {
  const now = Date.now();
  const job: StemJob = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    current: 0,
    total,
    log: [],
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

export function updateJob(id: string, patch: Partial<StemJob>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  job.updatedAt = Date.now();
}

export function appendLog(id: string, line: string): void {
  const job = jobs.get(id);
  if (!job) return;
  // Trim long lines to keep memory bounded.
  const trimmed = line.length > 500 ? `${line.slice(0, 500)}…` : line;
  job.log.push(trimmed);
  if (job.log.length > MAX_LOG_LINES) {
    job.log.splice(0, job.log.length - MAX_LOG_LINES);
  }
  job.updatedAt = Date.now();
}

export function getJob(id: string): StemJob | undefined {
  return jobs.get(id);
}

export function listJobs(): StemJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}
