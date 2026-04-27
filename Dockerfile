# ACE-Step UI — Packalares edition
# CUDA 13.0 + Python 3.11 + Node.js 18 + ACE-Step 1.5 + Express + React

FROM nvidia/cuda:13.0.2-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CUDA_HOME=/usr/local/cuda \
    PIP_NO_CACHE_DIR=1 \
    TOKENIZERS_PARALLELISM=false \
    NODE_ENV=production

WORKDIR /app

# Python 3.11 + Node.js 20 + system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3.11-dev \
    build-essential git ffmpeg libsndfile1 libsox-fmt-all sox curl gnupg \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install FFmpeg 7 shared libraries (torchcodec needs libavutil.so.59+)
# Ubuntu 22.04 only has FFmpeg 4. Build minimal FFmpeg 7 from source (shared libs only).
RUN apt-get update && apt-get install -y --no-install-recommends nasm pkg-config libmp3lame-dev \
    && curl -sL https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz | tar xJ -C /tmp \
    && cd /tmp/ffmpeg-7.0.2 \
    && ./configure --prefix=/usr --enable-shared --disable-static --disable-doc --enable-libmp3lame --enable-gpl \
    && make -j$(nproc) && make install && ldconfig \
    && cd / && rm -rf /tmp/ffmpeg-7.0.2 \
    && apt-get purge -y nasm && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Python venv
RUN python3.11 -m venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH
RUN pip install --upgrade pip setuptools wheel

# Clone ACE-Step 1.5
RUN git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5.git /app/ACE-Step-1.5

# Install ACE-Step deps (minus gradio and flash-attn, cu130 torch)
RUN cd /app/ACE-Step-1.5 && \
    sed -i '/^gradio/d' requirements.txt && \
    sed -i '/^flash-attn/d' requirements.txt && \
    sed -i 's/torch==2.10.0+cu128/torch==2.10.0+cu130/' requirements.txt && \
    sed -i 's/torchvision==0.25.0+cu128/torchvision==0.25.0+cu130/' requirements.txt && \
    sed -i 's/torchaudio==2.10.0+cu128/torchaudio==2.10.0+cu130/' requirements.txt && \
    pip install -r requirements.txt

# flash-attn prebuilt wheel (cu130 + torch 2.10 + python 3.11)
RUN pip install https://github.com/mjun0812/flash-attention-prebuild-wheels/releases/download/v0.9.0/flash_attn-2.8.3%2Bcu130torch2.10-cp311-cp311-linux_x86_64.whl

# nano-vllm + ACE-Step package
RUN pip install -e /app/ACE-Step-1.5/acestep/third_parts/nano-vllm && \
    pip install --no-deps -e /app/ACE-Step-1.5

# Pin torchcodec to 0.10.0 (0.11+ needs PyTorch > 2.10)
RUN pip install torchcodec==0.10.0

# Pin triton ≥3.0. Torch 2.10 ships with triton 2.3.1 by default, but modern
# transformers (≥4.55) routes through torch._inductor which does
# `import triton.backends.compiler` — that submodule only exists in triton 3.x.
# Without this pin, a cascading ImportError takes down FastAPI's LLM handler
# (acestep/llm_inference.py → from transformers import AutoTokenizer fails).
RUN pip install --no-cache-dir "triton>=3.0"

# Lyrics LLM (llama-cpp-python for GGUF model inference)
RUN pip install llama-cpp-python

# Server-side stem extraction (replaces browser-only Demucs at server/public/demucs-web).
# audio-separator bundles BS/Mel-Roformer + Demucs + MDX in one CLI/Python API.
RUN pip install --no-cache-dir "audio-separator[gpu]==0.44.1"

# Pre-warm checkpoints into the image so first separation is fast.
# Models live under AUDIO_SEPARATOR_MODEL_DIR; the Node server reads from there.
# Each prewarm is fault-tolerant — if a transient CDN error (HTTP 502 from
# github.com/TRvlvr/model_repo, etc.) breaks one download, the build still
# succeeds and audio-separator lazy-downloads that model on first use.
ENV AUDIO_SEPARATOR_MODEL_DIR=/app/.audio-separator-models
RUN mkdir -p ${AUDIO_SEPARATOR_MODEL_DIR} \
 && (audio-separator --download_model_only --model_file_dir ${AUDIO_SEPARATOR_MODEL_DIR} -m vocals_mel_band_roformer.ckpt \
     || echo "WARN: prewarm failed for vocals_mel_band_roformer.ckpt; will lazy-download at runtime") \
 && (audio-separator --download_model_only --model_file_dir ${AUDIO_SEPARATOR_MODEL_DIR} -m model_bs_roformer_ep_317_sdr_12.9755.ckpt \
     || echo "WARN: prewarm failed for model_bs_roformer_ep_317_sdr_12.9755.ckpt; will lazy-download at runtime") \
 && (audio-separator --download_model_only --model_file_dir ${AUDIO_SEPARATOR_MODEL_DIR} -m htdemucs_6s.yaml \
     || echo "WARN: prewarm failed for htdemucs_6s.yaml; will lazy-download at runtime")

# Patch: decouple api_server from Gradio imports
RUN cd /app/ACE-Step-1.5 && \
    sed -i 's|from acestep.ui.gradio.events.results_handlers import _build_generation_info|from acestep.ui.gradio.events.results.generation_info import _build_generation_info|' acestep/api_server.py && \
    echo "# Gradio imports disabled" > acestep/ui/gradio/__init__.py && \
    echo "# Gradio imports disabled" > acestep/ui/gradio/events/__init__.py && \
    echo "# Gradio imports disabled" > acestep/ui/gradio/events/wiring/__init__.py && \
    echo "# Gradio imports disabled" > acestep/ui/gradio/events/generation/__init__.py && \
    echo "# Gradio imports disabled" > acestep/ui/gradio/interfaces/__init__.py

# Patch: remove unsupported kwargs from auto-label routes
# label_all_samples() only accepts: dit_handler, llm_handler, format_lyrics,
# transcribe_lyrics, skip_metas, only_unlabeled, progress_callback
RUN cd /app/ACE-Step-1.5 && \
    sed -i '/chunk_size=request.chunk_size,/d; /batch_size=request.batch_size,/d; /sample_labeled_callback=/d' \
    acestep/api/train_api_dataset_auto_label_async_route.py \
    acestep/api/train_api_dataset_auto_label_sync_route.py 2>/dev/null || true

# Multilingual lyric transcription via faster-whisper. ACE-Step's 5Hz LM
# can't transcribe most non-English/Chinese lyrics; Whisper-large-v3
# covers 99+ languages. Used by python/whisper_cli.py during the stem
# extraction pipeline (BEFORE ACE-Step models load, GPU is empty).
RUN pip install --no-cache-dir faster-whisper

# IndexTTS2 — voice-cloned text-to-speech, used by python/indextts2_infer.py.
# Upstream EXPLICITLY requires the `uv` package manager and refuses support for
# pip installs (their pinned deps include torch==2.8 / transformers==4.52 /
# numpy==1.26 — all incompatible with ace-step's torch 2.10 / transformers 4.57
# in the main venv). So we install IndexTTS in its own uv-managed project venv
# at /app/indextts-src/.venv and subprocess into it from the Express server.
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
 && /root/.local/bin/uv --version \
 && git clone --depth 1 https://github.com/index-tts/index-tts.git /app/indextts-src \
 && cd /app/indextts-src && /root/.local/bin/uv sync \
 && /root/.local/bin/uv tool install "huggingface-hub[cli,hf_xet]" \
 && /root/.local/share/uv/tools/huggingface-hub/bin/hf download IndexTeam/IndexTTS-2 \
        --local-dir=/app/indextts-src/checkpoints

ENV INDEXTTS2_PROJECT=/app/indextts-src \
    INDEXTTS2_PYTHON=/app/indextts-src/.venv/bin/python \
    INDEXTTS2_MODEL_DIR=/app/indextts-src/checkpoints

# CTranslate2 (faster-whisper's backend) is built against CUDA 12, but this
# image runs CUDA 13 — libcublas.so.13 doesn't satisfy CTranslate2's
# libcublas.so.12 dependency. Install standalone CUDA 12 cuBLAS + cuDNN
# via pip (faster-whisper's documented workaround) and put their .so paths
# in LD_LIBRARY_PATH so CTranslate2 finds them at runtime.
RUN pip install --no-cache-dir nvidia-cublas-cu12 nvidia-cudnn-cu12

ENV LD_LIBRARY_PATH=/app/.venv/lib/python3.11/site-packages/nvidia/cublas/lib:/app/.venv/lib/python3.11/site-packages/nvidia/cudnn/lib:${LD_LIBRARY_PATH}

# Pre-warm Whisper-large-v3 into the image. Pinned path matches the
# default in WhisperContext; no first-run download at runtime.
ENV WHISPER_MODEL_DIR=/app/.whisper-models/large-v3
RUN python3 -c "from huggingface_hub import snapshot_download; \
    snapshot_download(repo_id='Systran/faster-whisper-large-v3', \
                      local_dir='${WHISPER_MODEL_DIR}')"

# Apply Whisper patch — only the priority fix in label_single.py (preloaded
# raw_lyrics from whisper_cli companion files override the LM's bad lyric
# transcription path). Whisper itself runs as a separate stage in the
# Express stem-extraction pipeline (server/src/services/audioSeparator.ts
# → python/whisper_cli.py) BEFORE ACE-Step's models load — no in-LM
# orchestration is needed.
COPY python/acestep_patches/label_single.py \
     /app/ACE-Step-1.5/acestep/training/dataset_builder_modules/label_single.py

# Apply trainer patch — saves current LoRA weights to <output_dir>/final/adapter
# when the user clicks Stop, instead of returning empty-handed. Upstream's
# stop handler just returns without checkpointing, so every Stop = lose all
# in-flight progress. Two should_stop branches in LoRATrainer get the same
# save-then-yield treatment; LoKr branches are left as upstream (unused here).
COPY python/acestep_patches/trainer.py \
     /app/ACE-Step-1.5/acestep/training/trainer.py

ENV PYTHONPATH=/app/ACE-Step-1.5

# Copy UI source
COPY package.json package-lock.json tsconfig.json vite.config.ts index.html /app/ui/
COPY components/ /app/ui/components/
COPY context/ /app/ui/context/
COPY services/ /app/ui/services/
COPY data/ /app/ui/data/
COPY hooks/ /app/ui/hooks/
COPY types/ /app/ui/types/
COPY i18n/ /app/ui/i18n/
COPY audiomass-editor/ /app/ui/audiomass-editor/
COPY App.tsx index.tsx types.ts global.d.ts vite-env.d.ts /app/ui/

# Python helpers invoked by the Node server via subprocess
# (currently: indextts2_infer.py for voice-cloned TTS).
COPY python/ /app/ui/python/

# Copy server source
COPY server/ /app/ui/server/

# Install Node dependencies
RUN cd /app/ui/server && npm ci 2>/dev/null || npm install

# Build React frontend to static files
RUN cd /app/ui && npm install --include=dev && npx vite build --outDir /app/ui/dist

# Create dirs
RUN mkdir -p /app/checkpoints /app/ui/server/data /app/ui/server/public/audio

# Environment
ENV ACESTEP_PATH=/app/ACE-Step-1.5 \
    ACESTEP_CHECKPOINTS_PATH=/app/checkpoints \
    ACE_STEP_HOST=0.0.0.0 \
    ACE_STEP_PORT=8000 \
    ACE_STEP_UI_PORT=3000 \
    ACESTEP_NO_INIT=true \
    ACESTEP_LM_BACKEND=pt \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=all

EXPOSE 3000

# Start script: ACE-Step FastAPI (background) + Express server (foreground)
COPY <<'EOF' /app/start.sh
#!/bin/bash
echo "Starting ACE-Step FastAPI on port 8000..."
cd /app/ACE-Step-1.5
python3 -c "
from acestep.api_server import create_app
import uvicorn
app = create_app()
uvicorn.run(app, host='0.0.0.0', port=8000)
" &

echo "Waiting for ACE-Step API..."
for i in $(seq 1 30); do
  curl -sf http://localhost:8000/health >/dev/null 2>&1 && break
  sleep 2
done

echo "Starting Express server on port 3000..."
cd /app/ui/server
exec npx tsx src/index.ts
EOF
RUN chmod +x /app/start.sh

HEALTHCHECK --interval=60s --timeout=10s --start-period=300s --retries=5 \
    CMD curl -sf http://localhost:3000/api/generate/health || exit 1

CMD ["/app/start.sh"]
