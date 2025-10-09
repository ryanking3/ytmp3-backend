FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg ca-certificates curl \
  && python3 -m pip install --no-cache-dir yt-dlp \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production

COPY src ./src

ENV PORT 8080
EXPOSE 8080

CMD ["node", "src/index.js"]
