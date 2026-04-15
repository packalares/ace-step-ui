/**
 * ACE-Step 1.5 integration via FastAPI (replaces Gradio client).
 * Connects to ACE-Step's built-in API server at /release_task, /query_result, etc.
 */

import { writeFile, mkdir, readFile } from 'fs/promises';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, '../../public/audio');

// ACE-Step FastAPI URL (default: http://localhost:8000)
const ACESTEP_API = config.acestep.apiUrl || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAudioDuration(filePath: string): number {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const duration = parseFloat(result.trim());
    return isNaN(duration) ? 0 : Math.round(duration);
  } catch {
    return 0;
  }
}

function isAudioFile(name: string): boolean {
  return /\.(mp3|flac|wav|ogg|m4a|opus|aac)$/i.test(name);
}

export async function fetchAPI(endpoint: string, body?: unknown): Promise<any> {
  const url = `${ACESTEP_API}${endpoint}`;
  const opts: RequestInit = {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ACE-Step API ${endpoint} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationParams {
  customMode: boolean;
  songDescription?: string;
  lyrics: string;
  style: string;
  title: string;
  instrumental: boolean;
  vocalLanguage?: string;
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  inferenceSteps?: number;
  guidanceScale?: number;
  batchSize?: number;
  randomSeed?: boolean;
  seed?: number;
  thinking?: boolean;
  enhance?: boolean;
  audioFormat?: string;
  inferMethod?: string;
  shift?: number;
  lmTemperature?: number;
  lmCfgScale?: number;
  lmTopK?: number;
  lmTopP?: number;
  lmNegativePrompt?: string;
  lmBackend?: string;
  lmModel?: string;
  referenceAudioUrl?: string;
  sourceAudioUrl?: string;
  referenceAudioTitle?: string;
  sourceAudioTitle?: string;
  audioCodes?: string;
  repaintingStart?: number;
  repaintingEnd?: number;
  instruction?: string;
  audioCoverStrength?: number;
  coverNoiseStrength?: number;
  taskType?: string;
  useAdg?: boolean;
  cfgIntervalStart?: number;
  cfgIntervalEnd?: number;
  customTimesteps?: string;
  useCotMetas?: boolean;
  useCotCaption?: boolean;
  useCotLanguage?: boolean;
  autogen?: boolean;
  constrainedDecodingDebug?: boolean;
  allowLmBatch?: boolean;
  getScores?: boolean;
  getLrc?: boolean;
  scoreScale?: number;
  lmBatchChunkSize?: number;
  trackName?: string;
  completeTrackClasses?: string[];
  isFormatCaption?: boolean;
  ditModel?: string;
  repaintMode?: string;
  repaintStrength?: number;
  velocityNormThreshold?: number;
  velocityEmaFactor?: number;
  latentShift?: number;
  latentRescale?: number;
  enableNormalization?: boolean;
  normalizationDb?: number;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  mp3Bitrate?: string;
  mp3SampleRate?: number;
}

interface GenerationResult {
  audioUrls: string[];
  duration: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  status: string;
}

interface JobStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  queuePosition?: number;
  etaSeconds?: number;
  progress?: number;
  stage?: string;
  result?: GenerationResult;
  error?: string;
}

interface ActiveJob {
  params: GenerationParams;
  startTime: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  taskId?: string;  // ACE-Step task_id
  queuePosition?: number;
  progress?: number;
  stage?: string;
  error?: string;
  result?: GenerationResult;
  rawResponse?: unknown;
}

// ---------------------------------------------------------------------------
// Job queue (in-memory)
// ---------------------------------------------------------------------------

const activeJobs = new Map<string, ActiveJob>();
const jobQueue: string[] = [];
let isProcessingQueue = false;

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (jobQueue.length > 0) {
    const jobId = jobQueue.shift()!;
    const job = activeJobs.get(jobId);
    if (!job) continue;

    try {
      await processGeneration(jobId, job.params, job);
    } catch (error: any) {
      console.error(`Job ${jobId}: Failed:`, error);
      job.status = 'failed';
      job.error = error.message || 'Generation failed';
    }
  }

  isProcessingQueue = false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateMusicViaAPI(params: GenerationParams): Promise<{ jobId: string }> {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const job: ActiveJob = {
    params,
    startTime: Date.now(),
    status: 'queued',
    queuePosition: jobQueue.length + 1,
  };

  activeJobs.set(jobId, job);
  jobQueue.push(jobId);

  console.log(`Job ${jobId}: Queued at position ${job.queuePosition}`);
  processQueue().catch(err => console.error('Queue processing error:', err));

  return { jobId };
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const job = activeJobs.get(jobId);

  if (!job) {
    return { status: 'failed', error: 'Job not found' };
  }

  if (job.status === 'succeeded' && job.result) {
    return { status: 'succeeded', result: job.result };
  }

  if (job.status === 'failed') {
    return { status: 'failed', error: job.error || 'Generation failed' };
  }

  if (job.status === 'queued') {
    return {
      status: 'queued',
      queuePosition: job.queuePosition,
      etaSeconds: (job.queuePosition || 1) * 180,
    };
  }

  // Running — check ACE-Step task status
  if (job.taskId) {
    try {
      const aceStatus = await pollAceStepTask(job.taskId);
      if (aceStatus) {
        job.progress = aceStatus.progress;
        job.stage = aceStatus.stage;
      }
    } catch { /* ignore poll errors */ }
  }

  const elapsed = Math.floor((Date.now() - job.startTime) / 1000);
  return {
    status: 'running',
    etaSeconds: Math.max(0, 180 - elapsed),
    progress: job.progress,
    stage: job.stage,
  };
}

export function getJobRawResponse(jobId: string): unknown | null {
  const job = activeJobs.get(jobId);
  return job?.rawResponse || null;
}

// ---------------------------------------------------------------------------
// Generation via ACE-Step FastAPI
// ---------------------------------------------------------------------------

export function resolveAudioPath(audioUrl: string): string {
  let srcPath = audioUrl;
  if (audioUrl.startsWith('/audio/')) {
    srcPath = path.join(AUDIO_DIR, audioUrl.replace('/audio/', ''));
  } else if (audioUrl.startsWith('http')) {
    try {
      const parsed = new URL(audioUrl);
      if (parsed.pathname.startsWith('/audio/')) {
        srcPath = path.join(AUDIO_DIR, parsed.pathname.replace('/audio/', ''));
      }
    } catch { /* fall through */ }
  }
  // ACE-Step API only accepts paths in /tmp or relative paths
  if (path.isAbsolute(srcPath) && !srcPath.startsWith('/tmp')) {
    const tmpPath = `/tmp/acestep_ref_${path.basename(srcPath)}`;
    try { execSync(`cp "${srcPath}" "${tmpPath}"`); } catch { /* ignore */ }
    return tmpPath;
  }
  return srcPath;
}

function buildReleaseTaskBody(params: GenerationParams): Record<string, unknown> {
  const caption = params.style || 'pop music';
  const prompt = params.customMode ? caption : (params.songDescription || caption);
  const lyrics = params.instrumental ? '[Instrumental]' : (params.lyrics || '');
  const isThinking = params.thinking ?? false;
  const isEnhance = params.enhance ?? false;
  const useCot = isEnhance || isThinking;

  const body: Record<string, unknown> = {
    prompt: prompt,
    lyrics: lyrics,
    thinking: isThinking,
    sample_mode: params.autogen ?? false,
    sample_query: params.songDescription || '',
    use_format: params.isFormatCaption ?? false,

    // Music params
    bpm: params.bpm && params.bpm > 0 ? params.bpm : null,
    key_scale: params.keyScale || '',
    time_signature: params.timeSignature || '',
    vocal_language: params.vocalLanguage || 'en',
    audio_duration: params.duration && params.duration > 0 ? params.duration : null,
    batch_size: Math.min(Math.max(params.batchSize ?? 2, 1), 16),

    // DiT params
    inference_steps: params.inferenceSteps ?? 8,
    guidance_scale: params.guidanceScale ?? 7.0,
    use_random_seed: params.randomSeed !== false,
    seed: params.seed ?? -1,
    shift: params.shift ?? 3.0,
    infer_method: params.inferMethod || 'ode',

    // Task type
    task_type: (params.taskType === 'audio2audio' ? 'cover' : params.taskType) || 'text2music',
    instruction: params.instruction || '',

    // Audio references (paths on the server filesystem)
    reference_audio_path: params.referenceAudioUrl ? resolveAudioPath(params.referenceAudioUrl) : null,
    src_audio_path: params.sourceAudioUrl ? resolveAudioPath(params.sourceAudioUrl) : null,

    // Cover/repaint
    audio_cover_strength: params.audioCoverStrength ?? 1.0,
    cover_noise_strength: params.coverNoiseStrength ?? 0.0,
    repainting_start: params.repaintingStart ?? 0.0,
    repainting_end: params.repaintingEnd ?? -1,
    repaint_mode: params.repaintMode || 'balanced',
    repaint_strength: params.repaintStrength ?? 0.5,

    // LM params
    lm_temperature: params.lmTemperature ?? 0.85,
    lm_cfg_scale: params.lmCfgScale ?? 2.0,
    lm_top_k: params.lmTopK ?? 0,
    lm_top_p: params.lmTopP ?? 0.9,
    lm_negative_prompt: params.lmNegativePrompt || 'NO USER INPUT',

    // CoT flags
    use_cot_metas: useCot ? (params.useCotMetas ?? true) : false,
    use_cot_caption: useCot ? (params.useCotCaption ?? true) : false,
    use_cot_language: useCot ? (params.useCotLanguage ?? true) : false,
    use_constrained_decoding: true,
    constrained_decoding_debug: params.constrainedDecodingDebug ?? false,
    allow_lm_batch: params.allowLmBatch ?? true,
    lm_batch_chunk_size: params.lmBatchChunkSize ?? 8,

    // Advanced DiT
    use_adg: params.useAdg ?? false,
    cfg_interval_start: params.cfgIntervalStart ?? 0.0,
    cfg_interval_end: params.cfgIntervalEnd ?? 1.0,
    custom_timesteps: params.customTimesteps || '',

    // Output
    audio_format: params.audioFormat || 'flac',
    mp3_bitrate: params.mp3Bitrate || '192k',
    mp3_sample_rate: params.mp3SampleRate || 48000,
    enable_normalization: params.enableNormalization ?? true,
    normalization_db: params.normalizationDb ?? -1.0,
    fade_in_duration: params.fadeInDuration ?? 0.0,
    fade_out_duration: params.fadeOutDuration ?? 0.0,
    latent_shift: params.latentShift ?? 0.0,
    latent_rescale: params.latentRescale ?? 1.0,

    // Scores + LRC
    get_scores: params.getScores ?? false,
    get_lrc: params.getLrc ?? false,
    score_scale: params.scoreScale ?? 0.5,

    // Audio codes
    audio_codes: params.audioCodes || '',

    // Track selection (extract/lego/complete)
    track_name: params.trackName || null,
    complete_track_classes: params.completeTrackClasses || [],

    // Model selection
    model: params.ditModel || null,

    // Velocity (advanced)
    velocity_norm_threshold: params.velocityNormThreshold ?? 0.0,
    velocity_ema_factor: params.velocityEmaFactor ?? 0.0,
  };

  return body;
}

async function processGeneration(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  job.status = 'running';
  job.stage = 'Submitting to ACE-Step...';

  // Guard: cover requires source audio
  if ((params.taskType === 'cover' || params.taskType === 'audio2audio') && !params.sourceAudioUrl && !params.audioCodes) {
    job.status = 'failed';
    job.error = `task_type='${params.taskType}' requires source audio or audio codes`;
    return;
  }

  // Submit to ACE-Step FastAPI
  const body = buildReleaseTaskBody(params);

  console.log(`Job ${jobId}: Submitting to ACE-Step /release_task`, {
    prompt: (body.prompt as string).slice(0, 50),
    duration: body.audio_duration,
    batchSize: body.batch_size,
    taskType: body.task_type,
  });

  const submitResp = await fetchAPI('/release_task', body);
  const taskId = submitResp?.data?.task_id;
  if (!taskId) {
    throw new Error(`No task_id from ACE-Step: ${JSON.stringify(submitResp)}`);
  }

  job.taskId = taskId;
  job.stage = 'Generating music...';
  console.log(`Job ${jobId}: ACE-Step task ${taskId} queued`);

  // Poll for completion
  const maxWaitMs = 20 * 60 * 1000; // 20 minutes
  const pollIntervalMs = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    const status = await pollAceStepTask(taskId);
    if (!status) continue;

    job.progress = status.progress;
    job.stage = status.stage;

    if (status.completed) {
      // Download audio files from ACE-Step to our audio dir
      const audioUrls = await downloadAceStepAudioFiles(jobId, status.audioFiles, params.audioFormat || 'flac');

      if (audioUrls.length === 0) {
        throw new Error('ACE-Step returned no audio files');
      }

      // Get duration from first file
      const firstFile = path.join(AUDIO_DIR, audioUrls[0].replace('/audio/', ''));
      const actualDuration = getAudioDuration(firstFile);

      job.status = 'succeeded';
      job.result = {
        audioUrls,
        duration: actualDuration || status.duration || params.duration || 0,
        bpm: status.bpm || params.bpm,
        keyScale: status.keyScale || params.keyScale,
        timeSignature: status.timeSignature || params.timeSignature,
        status: 'succeeded',
      };
      job.rawResponse = status.raw;

      console.log(`Job ${jobId}: Completed with ${audioUrls.length} audio files`);
      return;
    }

    if (status.failed) {
      throw new Error(status.error || 'ACE-Step generation failed');
    }
  }

  throw new Error('Generation timed out after 20 minutes');
}

// ---------------------------------------------------------------------------
// ACE-Step task polling
// ---------------------------------------------------------------------------

interface AceStepTaskStatus {
  completed: boolean;
  failed: boolean;
  progress: number;
  stage: string;
  audioFiles: string[];  // URLs like /v1/audio?path=...
  error?: string;
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  raw?: unknown;
}

async function pollAceStepTask(taskId: string): Promise<AceStepTaskStatus | null> {
  try {
    const resp = await fetchAPI('/query_result', {
      task_id_list: JSON.stringify([taskId]),
    });

    const data = resp?.data;
    if (!Array.isArray(data) || data.length === 0) return null;

    const job = data[0];
    const status = job.status; // 0=running, 1=succeeded, 2=failed

    // Parse result (JSON string)
    let resultItems: any[] = [];
    try {
      resultItems = typeof job.result === 'string' ? JSON.parse(job.result) : (job.result || []);
    } catch { resultItems = []; }

    if (status === 1) {
      // Succeeded — extract audio file URLs
      const audioFiles = resultItems
        .filter((r: any) => r.file && r.file.length > 0)
        .map((r: any) => r.file);

      const metas = resultItems[0]?.metas || {};

      return {
        completed: true,
        failed: false,
        progress: 1.0,
        stage: 'Done',
        audioFiles,
        duration: metas.duration,
        bpm: metas.bpm,
        keyScale: metas.keyscale,
        timeSignature: metas.timesignature,
        raw: job,
      };
    }

    if (status === 2) {
      const errorMsg = resultItems[0]?.error || job.progress_text || 'Generation failed';
      return {
        completed: false,
        failed: true,
        progress: 0,
        stage: 'Failed',
        audioFiles: [],
        error: errorMsg,
      };
    }

    // Still running (status 0)
    const progress = resultItems[0]?.progress ?? 0;
    const stage = resultItems[0]?.stage || job.progress_text || 'Generating...';
    return {
      completed: false,
      failed: false,
      progress,
      stage,
      audioFiles: [],
    };
  } catch (error) {
    console.warn(`Poll error for task ${taskId}:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Download audio from ACE-Step to local audio dir
// ---------------------------------------------------------------------------

async function downloadAceStepAudioFiles(
  jobId: string,
  audioFileUrls: string[],
  format: string,
): Promise<string[]> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const localUrls: string[] = [];

  for (let i = 0; i < audioFileUrls.length; i++) {
    const aceUrl = audioFileUrls[i];
    // aceUrl is like /v1/audio?path=%2Fapp%2F...
    const fullUrl = `${ACESTEP_API}${aceUrl}`;

    const ext = format === 'wav32' ? '.wav' : `.${format}`;
    const filename = `${jobId}_${i}${ext}`;
    const destPath = path.join(AUDIO_DIR, filename);

    try {
      const response = await fetch(fullUrl);
      if (!response.ok) {
        console.error(`Failed to download audio: ${response.status} from ${fullUrl}`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        console.error(`Empty audio file from ${fullUrl}`);
        continue;
      }
      await writeFile(destPath, buffer);
      localUrls.push(`/audio/${filename}`);
      console.log(`Downloaded audio: ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
    } catch (error) {
      console.error(`Failed to download audio ${aceUrl}:`, error);
    }
  }

  return localUrls;
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------

export async function getAudioStream(audioPath: string): Promise<Response> {
  if (audioPath.startsWith('http')) {
    return fetch(audioPath);
  }

  if (audioPath.startsWith('/audio/')) {
    const localPath = path.join(AUDIO_DIR, audioPath.replace('/audio/', ''));
    try {
      const buffer = await readFile(localPath);
      const ext = path.extname(localPath).slice(1);
      const mimeMap: Record<string, string> = {
        'flac': 'audio/flac', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
        'opus': 'audio/opus', 'mp3': 'audio/mpeg', 'aac': 'audio/aac',
      };
      return new Response(buffer, {
        status: 200,
        headers: { 'Content-Type': mimeMap[ext] || 'audio/mpeg' },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  // Absolute path
  if (existsSync(audioPath)) {
    try {
      const buffer = await readFile(audioPath);
      return new Response(buffer, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  return new Response(null, { status: 404 });
}

// ---------------------------------------------------------------------------
// Model management via ACE-Step FastAPI
// ---------------------------------------------------------------------------

export async function switchModel(modelName: string, options?: {
  initLlm?: boolean;
  lmModelPath?: string;
  slot?: number;
}): Promise<string> {
  const resp = await fetchAPI('/v1/init', {
    model: modelName,
    slot: options?.slot ?? 1,
    init_llm: options?.initLlm ?? true,
    lm_model_path: options?.lmModelPath,
  });
  return resp?.data?.message || 'Model loaded';
}

export async function getModels(): Promise<any> {
  return fetchAPI('/v1/models');
}

export async function getStats(): Promise<any> {
  return fetchAPI('/v1/stats');
}

// ---------------------------------------------------------------------------
// LoRA management via ACE-Step FastAPI
// ---------------------------------------------------------------------------

export async function loadLora(loraPath: string, adapterName?: string): Promise<string> {
  const resp = await fetchAPI('/v1/lora/load', {
    lora_path: loraPath,
    adapter_name: adapterName,
  });
  return resp?.data?.message || 'LoRA loaded';
}

export async function unloadLora(): Promise<string> {
  const resp = await fetchAPI('/v1/lora/unload', {});
  return resp?.data?.message || 'LoRA unloaded';
}

export async function toggleLora(useLora: boolean): Promise<string> {
  const resp = await fetchAPI('/v1/lora/toggle', { use_lora: useLora });
  return resp?.data?.message || `LoRA ${useLora ? 'enabled' : 'disabled'}`;
}

export async function setLoraScale(scale: number, adapterName?: string): Promise<string> {
  const resp = await fetchAPI('/v1/lora/scale', {
    scale,
    adapter_name: adapterName,
  });
  return resp?.data?.message || `LoRA scale set to ${scale}`;
}

export async function getLoraStatus(): Promise<any> {
  return fetchAPI('/v1/lora/status');
}

// ---------------------------------------------------------------------------
// Health / availability check
// ---------------------------------------------------------------------------

export async function isACEStepAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${ACESTEP_API}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

// Compatibility alias
export const isGradioAvailable = isACEStepAvailable;

// ---------------------------------------------------------------------------
// Missing exports used by routes/generate.ts
// ---------------------------------------------------------------------------

/** Clean up an ACE-Step job (best-effort, non-critical) */
export function cleanupJob(taskId: string): void {
  fetch(`${ACESTEP_API}/cleanup/${taskId}`, { method: 'POST' }).catch(() => {});
}

/** Download audio from ACE-Step API into a Buffer */
export async function downloadAudioToBuffer(audioUrl: string): Promise<{ buffer: Buffer }> {
  const url = audioUrl.startsWith('http') ? audioUrl : `${ACESTEP_API}${audioUrl}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download audio: ${resp.status}`);
  const arrayBuf = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuf) };
}

/** Discover ACE-Step API endpoints */
export async function discoverEndpoints(): Promise<string[]> {
  try {
    const resp = await fetch(`${ACESTEP_API}/openapi.json`);
    if (!resp.ok) return [];
    const spec = await resp.json() as any;
    return Object.keys(spec.paths || {});
  } catch {
    return [];
  }
}

/** Health check alias */
export const checkSpaceHealth = isACEStepAvailable;

/** Resolve python path inside ACE-Step venv */
export function resolvePythonPath(acestepDir: string): string {
  const venvPython = `${acestepDir}/venv/bin/python`;
  if (existsSync(venvPython)) return venvPython;
  const condaPython = `${acestepDir}/.conda/bin/python`;
  if (existsSync(condaPython)) return condaPython;
  return 'python3';
}
