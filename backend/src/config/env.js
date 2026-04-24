let cachedEnv = null;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const linkedInMaxPostsPerDay = toNumber(process.env.LINKEDIN_MAX_POSTS_PER_DAY, 1);
  const linkedInMaxActionsPerDay = toNumber(process.env.LINKEDIN_MAX_ACTIONS_PER_DAY, 30);
  const maxMetricValue = toNumber(process.env.MAX_METRIC_VALUE, 10000000);

  cachedEnv = {
    port: toNumber(process.env.PORT, 4000),
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
    databaseUrl: process.env.DATABASE_URL || "",
    huggingFaceApiToken: process.env.HF_TOKEN || "",
    mistralModel: process.env.MISTRAL_MODEL || "Qwen/Qwen2.5-7B-Instruct",
    flanModel: process.env.FLAN_MODEL || "Qwen/Qwen2.5-7B-Instruct",
    linkedInSafeMode: process.env.LINKEDIN_SAFE_MODE !== "false",
    linkedInPublishEnabled: process.env.LINKEDIN_PUBLISH_ENABLED === "true",
    linkedInMaxPostsPerDay,
    linkedInMaxActionsPerDay,
    defaultSchedulerTopic:
      process.env.DEFAULT_SCHEDULER_TOPIC || "engineering delivery lessons from real product incidents",
    maxMetricValue,
    linkedInSessionSecret: process.env.LINKEDIN_SESSION_SECRET || "",
    linkedInConnectTimeoutMs: toNumber(process.env.LINKEDIN_CONNECT_TIMEOUT_MS, 180000),
    defaultAppUserId: process.env.DEFAULT_APP_USER_ID || "local-user",
  };

  return cachedEnv;
}

module.exports = { loadEnv };
