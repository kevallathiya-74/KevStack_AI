const { saveLog } = require("./db");

const pendingLogs = [];
const MAX_PENDING_LOGS = 200;
const MAX_LOG_RETRIES = 2;
let flushingLogs = false;

async function flushLogQueue() {
  if (flushingLogs) {
    return;
  }

  flushingLogs = true;
  while (pendingLogs.length) {
    const entry = pendingLogs.shift();
    try {
      await saveLog(entry.payload);
    } catch (error) {
      if (entry.retryCount < MAX_LOG_RETRIES) {
        pendingLogs.push({ ...entry, retryCount: entry.retryCount + 1 });
      } else {
        console.error("[LOGGER]", `Failed to persist ${entry.levelLabel} log:`, error?.message || "Unknown logger error");
      }
    }
  }

  flushingLogs = false;
}

function persistLogSafely(payload, levelLabel) {
  try {
    if (pendingLogs.length >= MAX_PENDING_LOGS) {
      pendingLogs.shift();
    }

    pendingLogs.push({ payload, levelLabel, retryCount: 0 });
    Promise.resolve(flushLogQueue()).catch((error) => {
      console.error("[LOGGER]", `Failed to flush ${levelLabel} logs:`, error?.message || "Unknown logger error");
    });
  } catch (error) {
    console.error("[LOGGER]", `Failed to persist ${levelLabel} log:`, error?.message || "Unknown logger error");
  }
}

function logInfo(message, details = {}) {
  const payload = { message, ...details };
  console.log("[INFO]", message, Object.keys(details).length ? JSON.stringify(details) : "");
  persistLogSafely({ level: "info", type: "SYSTEM_INFO", message, details: payload }, "info");
}

function logError(type, cause, fixApplied, details = {}) {
  console.error("[ERROR]", `[${type}]`, cause, "| Fix:", fixApplied);
  persistLogSafely(
    {
      level: "error",
      type,
      message: cause,
      cause,
      fix_applied: fixApplied,
      details,
    },
    "error"
  );
}

function logProductEvent(type, message, action, options = {}) {
  const status = typeof options.status === "string" ? options.status.toLowerCase() : "success";
  const details = options.details && typeof options.details === "object" ? options.details : {};
  const level = status === "error" ? "error" : status === "warning" ? "warning" : "info";

  console.log(`[${level.toUpperCase()}]`, `[${type}]`, message, "| Action:", action);
  persistLogSafely(
    {
      level,
      type,
      message,
      cause: message,
      fix_applied: action,
      details,
    },
    level
  );
}

module.exports = {
  logInfo,
  logError,
  logProductEvent,
};
