const { saveLog } = require("./db");

function persistLogSafely(payload, levelLabel) {
  try {
    Promise.resolve(saveLog(payload)).catch((error) => {
      console.error("[LOGGER]", `Failed to persist ${levelLabel} log:`, error?.message || "Unknown logger error");
    });
  } catch (error) {
    console.error("[LOGGER]", `Failed to persist ${levelLabel} log:`, error?.message || "Unknown logger error");
  }
}

function logInfo(message, details = {}) {
  const payload = { message, ...details };
  console.log("[INFO]", message, Object.keys(details).length ? JSON.stringify(details) : "");
  persistLogSafely({ level: "info", details: payload }, "info");
}

function logError(type, cause, fixApplied, details = {}) {
  console.error("[ERROR]", `[${type}]`, cause, "| Fix:", fixApplied);
  persistLogSafely(
    {
      level: "error",
      type,
      cause,
      fix_applied: fixApplied,
      details,
    },
    "error"
  );
}

module.exports = {
  logInfo,
  logError,
};
