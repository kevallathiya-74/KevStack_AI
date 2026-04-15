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

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(new Error("Missing request origin"));
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

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "kevstack-ai-backend" });
});

app.use("/api", createApiRouter());

app.use((err, _req, res, _next) => {
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
