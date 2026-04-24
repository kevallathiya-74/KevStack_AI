require("dotenv").config();

const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const { loadEnv } = require("./src/config/env");
const { AppError } = require("./src/lib/http");
const { formatValidationMessage } = require("./src/lib/validation");
const { createApiRouter } = require("./src/routes/api");
const { initDatabase } = require("./src/services/db");
const { logger, logError, logInfo } = require("./src/services/logger");
const { startScheduler } = require("./src/services/scheduler");

const app = express();
const env = loadEnv();
const allowedOrigins = env.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function validateRuntimeConfiguration() {
  const missing = [];
  if (!env.databaseUrl) missing.push("DATABASE_URL");
  if (!env.huggingFaceApiToken) missing.push("HF_TOKEN");
  if (!env.linkedInSessionSecret) missing.push("LINKEDIN_SESSION_SECRET");

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (!Number.isInteger(env.linkedInMaxPostsPerDay) || env.linkedInMaxPostsPerDay < 1) {
    throw new Error("LINKEDIN_MAX_POSTS_PER_DAY must be a positive integer.");
  }

  if (!Number.isInteger(env.maxMetricValue) || env.maxMetricValue < 1) {
    throw new Error("MAX_METRIC_VALUE must be a positive integer.");
  }

  if (!Number.isInteger(env.linkedInMaxActionsPerDay) || env.linkedInMaxActionsPerDay < 1) {
    throw new Error("LINKEDIN_MAX_ACTIONS_PER_DAY must be a positive integer.");
  }
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({
      success: false,
      data: null,
      error: {
        code: "rate_limit_exceeded",
        message: "Too many requests. Please wait a moment and retry.",
      },
      meta: null,
    });
  },
});

const contentGenerationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    return `${ipKeyGenerator(req.ip)}:${req.path}`;
  },
  handler(_req, res) {
    res.status(429).json({
      success: false,
      data: null,
      error: {
        code: "rate_limit_exceeded",
        message: "Too many generation requests. Please wait a minute and try again.",
      },
      meta: null,
    });
  },
});

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  pinoHttp({
    logger,
    genReqId(req, res) {
      const existing = req.headers["x-request-id"];
      if (existing) {
        return existing;
      }

      const generated = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      res.setHeader("x-request-id", generated);
      return generated;
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  })
);
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: false,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(apiLimiter);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "kevstack-ai-backend",
    version: "v1",
  });
});

app.use("/api", createApiRouter({ contentGenerationLimiter }));
app.use("/api/v1", createApiRouter({ contentGenerationLimiter }));

app.use((err, req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({
      success: false,
      data: null,
      error: {
        code: "validation_error",
        message: "Invalid JSON body. Please send a valid JSON payload.",
      },
      meta: {
        requestId: req.id,
      },
    });
    return;
  }

  const status = Number.isInteger(err?.status) ? err.status : 500;
  const code = typeof err?.code === "string" && err.code ? err.code : "internal_server_error";
  const validationMessage = formatValidationMessage(err);
  const message =
    status >= 500
      ? "An unexpected error occurred."
      : validationMessage || err?.message || "Request could not be completed.";

  if (status >= 500) {
    logError("API_FAILURE", err?.message || "Unhandled backend error", "Global error middleware response", {
      stack: err?.stack,
      status: err?.status,
      code: err?.code,
      requestId: req.id,
    });
  } else {
    logInfo("Client request rejected", {
      status,
      code,
      message,
      requestId: req.id,
    });
  }

  res.status(status).json({
    success: false,
    data: null,
    error: {
      code,
      message,
      details: err instanceof AppError ? err.details : undefined,
    },
    meta: {
      requestId: req.id,
    },
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
