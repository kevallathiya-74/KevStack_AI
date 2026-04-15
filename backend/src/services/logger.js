const { saveLog } = require("./db");

function logInfo(message, details = {}) {
  const payload = { message, ...details };
  console.log("[INFO]", message, Object.keys(details).length ? JSON.stringify(details) : "");
  saveLog({ level: "info", details: payload }).catch(() => {});
}

function logError(type, cause, fixApplied, details = {}) {
  console.error("[ERROR]", `[${type}]`, cause, "| Fix:", fixApplied);
  saveLog({
    level: "error",
    type,
    cause,
    fix_applied: fixApplied,
    details,
  }).catch(() => {});
}

module.exports = {
  logInfo,
  logError,
};
