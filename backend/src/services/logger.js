const pino = require("pino");
const { saveLog } = require("./db");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.x-api-key",
      "headers.authorization",
      "headers.x-api-key",
      "details.linkedInPassword",
      "details.huggingFaceApiToken",
    ],
    censor: "[REDACTED]",
  },
});

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
        logger.error(
          {
            err: error,
            logType: entry.payload.type,
          },
          "Failed to persist log entry"
        );
      }
    }
  }

  flushingLogs = false;
}

function persistLogSafely(payload) {
  if (pendingLogs.length >= MAX_PENDING_LOGS) {
    pendingLogs.shift();
  }

  pendingLogs.push({ payload, retryCount: 0 });
  Promise.resolve(flushLogQueue()).catch((error) => {
    logger.error({ err: error }, "Failed to flush log queue");
  });
}

function logInfo(message, details = {}) {
  logger.info(details, message);
  persistLogSafely({ level: "info", type: "SYSTEM_INFO", message, details: { message, ...details } });
}

function logWarn(type, message, details = {}) {
  logger.warn({ type, ...details }, message);
  persistLogSafely({
    level: "warning",
    type,
    message,
    cause: message,
    fix_applied: details.fixApplied || "",
    details,
  });
}

function logError(type, cause, fixApplied, details = {}) {
  logger.error({ type, fixApplied, ...details }, cause);
  persistLogSafely({
    level: "error",
    type,
    message: cause,
    cause,
    fix_applied: fixApplied,
    details,
  });
}

function logProductEvent(type, message, action, options = {}) {
  const status = typeof options.status === "string" ? options.status.toLowerCase() : "success";
  const details = options.details && typeof options.details === "object" ? options.details : {};
  const level = status === "error" ? "error" : status === "warning" ? "warn" : "info";

  logger[level]({ type, action, status, ...details }, message);
  persistLogSafely({
    level: status === "warning" ? "warning" : status === "error" ? "error" : "info",
    type,
    message,
    cause: message,
    fix_applied: action,
    details,
  });
}

module.exports = {
  logger,
  logError,
  logInfo,
  logProductEvent,
  logWarn,
};
