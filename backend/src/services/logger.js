const { saveLog } = require("./db");

function logInfo(message, details = {}) {
  const payload = { message, ...details };
  console.log("[INFO]", message, Object.keys(details).length ? JSON.stringify(details) : "");
  saveLog({ level: "info", details: payload }).catch((error) => {
    console.error("[LOGGER]", "Failed to persist info log:", error?.message || "Unknown logger error");
  });
}

function logError(type, cause, fixApplied, details = {}) {
  console.error("[ERROR]", `[${type}]`, cause, "| Fix:", fixApplied);
  saveLog({
    level: "error",
    type,
    cause,
    fix_applied: fixApplied,
    details,
  }).catch((error) => {
    console.error("[LOGGER]", "Failed to persist error log:", error?.message || "Unknown logger error");
  });
}

module.exports = {
  logInfo,
  logError,
};
