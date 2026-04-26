# ── Maktaba Bridge — Docker image ──────────────────────────────────────────
# Works on Railway, Render, Fly.io, or any Docker host.
# Installs Node.js + Python + yt-dlp so the bridge can extract YouTube audio.

FROM node:20-slim

# Install Python + pip (needed for yt-dlp) + ffmpeg (needed by yt-dlp for audio)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      ffmpeg \
      curl \
    && pip3 install -U yt-dlp --break-system-packages \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy bridge source
COPY server.js ./

# Railway/Render inject PORT via env var; default 3847 for local use
EXPOSE 3847

CMD ["node", "server.js"]
