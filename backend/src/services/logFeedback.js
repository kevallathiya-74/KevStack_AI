const HIDDEN_TYPES = new Set(["SYSTEM_INFO", "DEBUG", "SERVER"]);
const MAX_FEEDBACK_LOGS = 80;

function toLogText(log) {
  return [log?.type, log?.message, log?.cause, log?.fix_applied]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function simplifyErrorDescription(log) {
  const text = toLogText(log);

  if (text.includes("selector") || text.includes("playwright") || text.includes("ui")) {
    return "Posting failed due to a UI change. Fix applied automatically.";
  }

  if (text.includes("timeout")) {
    return "Something took too long while preparing your content. The system is retrying.";
  }

  if (text.includes("invalid") && text.includes("response")) {
    return "The AI response was invalid. A safer retry was triggered automatically.";
  }

  if (text.includes("quality") || text.includes("too short") || text.includes("quality checks")) {
    return "Generated content did not meet quality standards. The system is improving the draft.";
  }

  if (text.includes("rate limit") || text.includes("too many")) {
    return "Too many requests were detected. The system is pacing retries to keep things stable.";
  }

  if (text.includes("database") || text.includes("connection") || text.includes("not initialized")) {
    return "Data service is temporarily unavailable. Recovery is in progress.";
  }

  if (text.includes("axioserror") || text.includes("internal server error")) {
    return "Something went wrong while processing your request. Retrying automatically.";
  }

  return "Something went wrong. The system is applying a safe recovery path.";
}

function mapLogToFeedback(log) {
  const type = String(log?.type || "").trim().toUpperCase();
  const text = toLogText(log);
  const isRetryFlow = text.includes("retry") || text.includes("rate limit") || text.includes("too many requests");

  if (HIDDEN_TYPES.has(type)) {
    return null;
  }

  const byType = {
    CONTENT_GENERATED: {
      title: "Content Generated",
      description: "Your LinkedIn post has been created successfully with optimized structure.",
      status: "success",
      action: "Ready for publishing",
    },
    HOOK_OPTIMIZED: {
      title: "Hook Optimized",
      description: "The strongest hook was selected to improve post engagement.",
      status: "success",
      action: "Hook applied to final draft",
    },
    POST_READY: {
      title: "Post Ready",
      description: "Your post is ready for review and publishing.",
      status: "success",
      action: "Open Content Studio to publish",
    },
    POST_PUBLISHED: {
      title: "Post Published",
      description: "Your post is now published on LinkedIn.",
      status: "success",
      action: "Publishing completed",
    },
    RETRY_ATTEMPT: {
      title: "Retry in Progress",
      description: "A temporary issue was detected and the system is retrying automatically.",
      status: "warning",
      action: "Automatic retry scheduled",
    },
    IMPROVEMENT_APPLIED: {
      title: "Improvement Applied",
      description: "Performance insights were used to improve the next content cycle.",
      status: "warning",
      action: "Optimization strategy updated",
    },
    AUTOMATION_FAILURE: {
      title: "Posting Failed",
      description: "Posting failed due to a UI change. Fix applied automatically.",
      status: "error",
      action: "Automation fallback applied",
    },
    API_FAILURE: {
      title: isRetryFlow ? "Retry in Progress" : "Generation Issue",
      description: simplifyErrorDescription(log),
      status: isRetryFlow ? "warning" : "error",
      action: isRetryFlow ? "Retrying automatically" : "Retrying with safer settings",
    },
    DEPENDENCY_ISSUE: {
      title: "Service Temporarily Unavailable",
      description: "A required service is unavailable right now.",
      status: "error",
      action: "Recovery in progress",
    },
    UI_CRASH: {
      title: "Interface Error",
      description: "A temporary interface issue occurred during processing.",
      status: "error",
      action: "System recovery applied",
    },
  };

  const mapped = byType[type] || null;
  if (!mapped) {
    const level = String(log?.level || "").toLowerCase();
    if (level !== "error" && level !== "warning") {
      return null;
    }

    return {
      title: "System Update",
      description: level === "error" ? simplifyErrorDescription(log) : "A system update was applied successfully.",
      status: level === "error" ? "error" : "warning",
      action: level === "error" ? "Retrying automatically" : "Monitoring next update",
    };
  }

  return mapped;
}

function toFeedbackLog(log) {
  const mapped = mapLogToFeedback(log);
  if (!mapped) {
    return null;
  }

  const createdAt = new Date(log?.created_at || Date.now());
  const isValidDate = !Number.isNaN(createdAt.getTime());
  const safeDate = isValidDate ? createdAt : new Date();

  return {
    id: Number(log?.id || 0),
    title: mapped.title,
    description: mapped.description,
    status: mapped.status,
    time: safeDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    action: mapped.action,
    created_at: safeDate.toISOString(),
  };
}

function transformLogsForFeedback(rawLogs) {
  const feedback = (Array.isArray(rawLogs) ? rawLogs : []).map(toFeedbackLog).filter(Boolean);

  feedback.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return feedback.slice(0, MAX_FEEDBACK_LOGS);
}

module.exports = {
  transformLogsForFeedback,
};
