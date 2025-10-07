# Dockerfile
FROM node:20-bullseye-slim

# Install system deps and yt-dlp + ffmpeg
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg ca-certificates curl \
  && python3 -m pip install --no-cache-dir yt-dlp \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create app dir
WORKDIR /app

# Copy package and install
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy source
COPY src ./src

# Expose
ENV PORT 8080
EXPOSE 8080

CMD ["node", "src/index.js"]
