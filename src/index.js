const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const API_KEY = process.env.API_KEY || null; // optional
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
const TMP_DIR = process.env.TMP_DIR || "/tmp";
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || "2", 10);

if (CORS_ORIGINS.length > 0) {
  app.use(cors({ origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return CORS_ORIGINS.includes(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"));
  }}));
} else {
  app.use(cors());
}

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
});
app.use(limiter);

let currentJobs = 0;

function validateYouTubeUrl(urlString) {
  try {
    const u = new URL(urlString);
    const host = u.hostname.toLowerCase();
    return host.includes("youtube.com") || host.includes("youtu.be");
  } catch (e) {
    return false;
  }
}

function uniquePrefix() {
  return "audio-" + crypto.randomBytes(8).toString("hex");
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/convert", async (req, res) => {
  try {
    if (API_KEY && req.body.apiKey !== API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { url } = req.body || {};
    if (!url || typeof url !== "string" || !validateYouTubeUrl(url)) {
      return res.status(400).json({ error: "Invalid or missing YouTube URL" });
    }

    if (currentJobs >= MAX_CONCURRENT) {
      return res.status(429).json({ error: "Server busy — try again later" });
    }
    currentJobs++;

    const prefix = uniquePrefix();
    const outPattern = path.join(TMP_DIR, `${prefix}.%(ext)s`); // yt-dlp will expand ext
    const args = ["-x", "--audio-format", "mp3", "-o", outPattern, url, "--no-playlist", "--no-warnings", "--no-call-home", "--no-progress"];

    const ytdlp = spawn("yt-dlp", args);

    let stderr = "";
    ytdlp.stderr.on("data", (b) => { stderr += b.toString(); console.error("[yt-dlp]", b.toString()); });
    ytdlp.stdout.on("data", (b) => console.log("[yt-dlp stdout]", b.toString()));

    ytdlp.on("error", (err) => {
      console.error("Failed to start yt-dlp:", err);
    });

    ytdlp.on("close", (code) => {
      (async () => {
        try {
          if (code !== 0) {
            console.error("yt-dlp failed:", code, stderr);
            currentJobs = Math.max(0, currentJobs - 1);
            return res.status(500).json({ error: "Conversion failed", details: stderr.slice(0, 1000) });
          }

          const files = fs.readdirSync(TMP_DIR);
          const match = files.find(f => f.startsWith(prefix) && f.toLowerCase().endsWith(".mp3"));
          if (!match) {
            currentJobs = Math.max(0, currentJobs - 1);
            console.error("No output file found for", prefix);
            return res.status(500).json({ error: "No output file found" });
          }

          const filePath = path.join(TMP_DIR, match);
          const stat = fs.statSync(filePath);

          res.setHeader("Content-Type", "audio/mpeg");
          const safeName = (match.replace(/\s+/g, "_"));
          res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
          res.setHeader("Content-Length", stat.size);

          const readStream = fs.createReadStream(filePath);
          readStream.pipe(res);

          readStream.on("close", () => {
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
            currentJobs = Math.max(0, currentJobs - 1);
          });

          readStream.on("error", (err) => {
            console.error("Stream error:", err);
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
            if (!res.headersSent) res.status(500).end("Stream error");
            currentJobs = Math.max(0, currentJobs - 1);
          });

        } catch (err) {
          console.error("Post-processing error:", err);
          currentJobs = Math.max(0, currentJobs - 1);
          if (!res.headersSent) res.status(500).json({ error: "Internal error" });
        }
      })();
    });

    req.on("close", () => {
      if (!res.writableEnded) {
        try { ytdlp.kill("SIGKILL"); } catch (e) {}
      }
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    currentJobs = Math.max(0, currentJobs - 1);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`ytmp3-backend listening on http://0.0.0.0:${PORT}`);
});
