FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Install Python 3.10 + system dependencies
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3.10-dev \
    python3-pip \
    ffmpeg \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    git \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf python3.10 /usr/bin/python3 \
    && ln -sf python3 /usr/bin/python \
    && ln -sf pip3 /usr/bin/pip

# Copy requirements
COPY requirements.txt .

# numpy first: pkuseg (pulled in transitively by chatterbox-tts) has a
# legacy setup.py that does `import numpy` at build time without declaring
# it as a build dependency, so it must already be importable before the
# main install below reaches it.
#
# Both installs below are wrapped in a retry loop with `timeout` rather than
# relying on pip's own --retries/--timeout: this environment has repeatedly
# shown a stalled connection that trickles zero bytes without ever tripping
# pip's socket timeout, hanging for 10+ minutes on a single large wheel.
# `timeout` hard-kills and retries the whole pip invocation instead; dropping
# --no-cache-dir lets each retry skip wheels a prior attempt already fetched.
RUN for i in $(seq 1 10); do \
      timeout 180 pip install --retries 5 --timeout 30 numpy==1.25.2 && break; \
      echo "numpy install attempt $i failed/timed out, retrying..."; \
      sleep 3; \
    done

# Install PyTorch with CUDA 11.8 BEFORE requirements.txt, pinned to EXACTLY
# what chatterbox-tts requires (torch==2.6.0 / torchaudio==2.6.0 — every
# viable chatterbox-tts release pins these with no room to negotiate; verify
# via `pip index versions` / PyPI's requires_dist before ever changing this).
# Installing a torch version chatterbox-tts doesn't ask for is worse than
# skipping this step: pip's resolver will silently reinstall whatever
# version requirements.txt below actually needs — which, with no CUDA index
# active at that point, means a CPU-only torch quietly replacing this one,
# and the "GPU build" shipping without GPU support and no error to show it.
RUN for i in $(seq 1 10); do \
      timeout 300 pip install --retries 5 --timeout 30 \
        torch==2.6.0+cu118 torchvision==0.21.0+cu118 torchaudio==2.6.0+cu118 \
        --index-url https://download.pytorch.org/whl/cu118 && break; \
      echo "torch install attempt $i failed/timed out, retrying..."; \
      sleep 3; \
    done

# Install remaining Python dependencies
RUN for i in $(seq 1 10); do \
      timeout 300 pip install --retries 5 --timeout 30 -r requirements.txt && break; \
      echo "requirements install attempt $i failed/timed out, retrying..."; \
      sleep 3; \
    done

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /tmp/avatars /tmp/videos /tmp/audio voice_profiles

# Entrypoint: run migrations then start server
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Expose port
EXPOSE 8000

# Health check — longer start-period for model loading on first boot
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

# Run application via entrypoint (handles migrations automatically)
CMD ["./entrypoint.sh"]
