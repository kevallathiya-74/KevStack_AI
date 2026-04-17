require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { loadEnv } = require("./src/config/env");
const { initDatabase } = require("./src/services/db");
const { createApiRouter } = require("./src/routes/api");
const { startScheduler } = require("./src/services/scheduler");
const { logInfo, logError } = require("./src/services/logger");

const app = express();
const env = loadEnv();
const allowedOrigins = env.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin);
const generationRequestWindowMs = 60000;
const generationRequestLimit = 12;
const generationRequestLog = new Map();

function validateRuntimeConfiguration() {
  const missing = [];
  if (!env.databaseUrl) missing.push("DATABASE_URL");
  if (!env.huggingFaceApiToken) missing.push("HUGGING_FACE_API_TOKEN");

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (!Number.isInteger(env.linkedInMaxPostsPerDay) || env.linkedInMaxPostsPerDay < 1) {
    throw new Error("LINKEDIN_MAX_POSTS_PER_DAY must be a positive integer.");
  }

  if (!Number.isInteger(env.maxMetricValue) || env.maxMetricValue < 1) {
    throw new Error("MAX_METRIC_VALUE must be a positive integer.");
  }
}

function applyGenerationRateLimit(req, res, next) {
  const isContentGenerationRoute = req.method === "POST" && req.path.startsWith("/api/content");
  if (!isContentGenerationRoute) {
    next();
    return;
  }

  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const recentRequests = (generationRequestLog.get(ip) || []).filter((timestamp) => now - timestamp < generationRequestWindowMs);

  if (recentRequests.length >= generationRequestLimit) {
    res.status(429).json({
      error: "rate_limit_exceeded",
      message: "Too many generation requests. Please wait a minute and try again.",
    });
    return;
  }

  recentRequests.push(now);
  generationRequestLog.set(ip, recentRequests);
  next();
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(applyGenerationRateLimit);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "kevstack-ai-backend" });
});

app.use("/api", createApiRouter());

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({
      error: "validation_error",
      message: "Invalid JSON body. Please send a valid JSON payload.",
    });
    return;
  }

  logError("API_FAILURE", err?.message || "Unhandled backend error", "Global error middleware response", {
    stack: err?.stack,
  });

  res.status(500).json({
    error: "internal_server_error",
    message: "An unexpected error occurred.",
  });
});

async function start() {
  try {
    validateRuntimeConfiguration();
    await initDatabase();
    startScheduler();

    app.listen(env.port, () => {
      logInfo("Backend started", { port: env.port });
    });
  } catch (error) {
    logError(
      "DEPENDENCY_ISSUE",
      error?.message || "Failed to start backend",
      "Process exit after startup failure",
      { stack: error?.stack }
    );
    process.exit(1);
  }
}

start();
