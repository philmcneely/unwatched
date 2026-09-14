# Periodic island snapshotter for the region map. System Chromium + puppeteer-core (no bundled download).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm init -y >/dev/null 2>&1 && npm i puppeteer-core@23 >/dev/null 2>&1
COPY snapshot.js .
ENV CHROMIUM=/usr/bin/chromium SNAP_DIR=/data/snaps HUB_URL=http://uw2-hub:4600 INTERVAL_MIN=45
CMD ["node", "snapshot.js"]
