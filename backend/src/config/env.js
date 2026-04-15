function loadEnv() {
  return {
    port: Number(process.env.PORT || 4000),
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
    databaseUrl: process.env.DATABASE_URL || "",
    huggingFaceApiToken: process.env.HUGGING_FACE_API_TOKEN || "",
    mistralModel: process.env.MISTRAL_MODEL || "mistralai/Mistral-7B-Instruct-v0.2",
    flanModel: process.env.FLAN_MODEL || "google/flan-t5-large",
    linkedInSafeMode: process.env.LINKEDIN_SAFE_MODE !== "false",
    linkedInMaxPostsPerDay: Number(process.env.LINKEDIN_MAX_POSTS_PER_DAY || 1),
    seedMetricsRanges: {
      impressionsMin: Number(process.env.SEED_IMPRESSIONS_MIN || 100),
      impressionsMax: Number(process.env.SEED_IMPRESSIONS_MAX || 300),
      likesMin: Number(process.env.SEED_LIKES_MIN || 3),
      likesMax: Number(process.env.SEED_LIKES_MAX || 23),
      commentsMin: Number(process.env.SEED_COMMENTS_MIN || 1),
      commentsMax: Number(process.env.SEED_COMMENTS_MAX || 9),
      sharesMin: Number(process.env.SEED_SHARES_MIN || 1),
      sharesMax: Number(process.env.SEED_SHARES_MAX || 6),
    },
  };
}

module.exports = { loadEnv };
