function loadEnv() {
  const linkedInMaxPostsPerDay = Number(process.env.LINKEDIN_MAX_POSTS_PER_DAY || 1);
  const linkedInMaxActionsPerDay = Number(process.env.LINKEDIN_MAX_ACTIONS_PER_DAY || 30);
  const maxMetricValue = Number(process.env.MAX_METRIC_VALUE || 10000000);

  return {
    port: Number(process.env.PORT || 4000),
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
    databaseUrl: process.env.DATABASE_URL || "",
    huggingFaceApiToken: process.env.HF_TOKEN || "",
    mistralModel: process.env.MISTRAL_MODEL || "Qwen/Qwen2.5-7B-Instruct",
    flanModel: process.env.FLAN_MODEL || "Qwen/Qwen2.5-7B-Instruct",
    linkedInSafeMode: process.env.LINKEDIN_SAFE_MODE !== "false",
    linkedInPublishEnabled: process.env.LINKEDIN_PUBLISH_ENABLED === "true",
    linkedInEmail: process.env.LINKEDIN_EMAIL || "",
    linkedInPassword: process.env.LINKEDIN_PASSWORD || "",
    linkedInMaxPostsPerDay,
    linkedInMaxActionsPerDay,
    defaultSchedulerTopic:
      process.env.DEFAULT_SCHEDULER_TOPIC || "engineering delivery lessons from real product incidents",
    maxMetricValue,
  };
}

module.exports = { loadEnv };
