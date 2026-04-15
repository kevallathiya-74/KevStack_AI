function loadEnv() {
  return {
    port: Number(process.env.PORT || 4000),
    corsOrigin: process.env.CORS_ORIGIN || "*",
    databaseUrl: process.env.DATABASE_URL || "",
    huggingFaceApiToken: process.env.HUGGING_FACE_API_TOKEN || "",
    mistralModel: process.env.MISTRAL_MODEL || "mistralai/Mistral-7B-Instruct-v0.2",
    flanModel: process.env.FLAN_MODEL || "google/flan-t5-large",
    linkedInSafeMode: process.env.LINKEDIN_SAFE_MODE !== "false",
    linkedInMaxPostsPerDay: Number(process.env.LINKEDIN_MAX_POSTS_PER_DAY || 1),
  };
}

module.exports = { loadEnv };
