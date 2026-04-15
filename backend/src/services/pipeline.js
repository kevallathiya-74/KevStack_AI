const {
  analyzerAgent,
  strategyAgent,
  contentGeneratorAgent,
  hookGeneratorAgent,
  engagementAgent,
  learningAgent,
} = require("./agents");
const { savePost, saveMetric } = require("./db");
const { logInfo, logError } = require("./logger");
const { loadEnv } = require("../config/env");

const env = loadEnv();

function categorizeError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("module") || message.includes("depend")) return "DEPENDENCY_ISSUE";
  if (message.includes("timeout") || message.includes("api") || message.includes("network")) return "API_FAILURE";
  if (message.includes("selector") || message.includes("playwright") || message.includes("automation")) {
    return "AUTOMATION_FAILURE";
  }
  return "UI_CRASH";
}

async function runContentPipeline(topic) {
  try {
    logInfo("Pipeline started", { topic });

    const analysis = await analyzerAgent(topic);
    const strategy = await strategyAgent(topic, analysis);
    const content = await contentGeneratorAgent(topic, strategy);
    const { hooks, cta } = await hookGeneratorAgent(topic, content);
    const mergedContent = await engagementAgent(content, hooks);

    const post = await savePost({
      topic,
      content: mergedContent,
      hooks,
      cta,
      status: "generated",
    });

    const ranges = env.seedMetricsRanges;
    const seedMetrics = await saveMetric({
      post_id: post.id,
      impressions: Math.floor(Math.random() * (ranges.impressionsMax - ranges.impressionsMin) + ranges.impressionsMin),
      likes: Math.floor(Math.random() * (ranges.likesMax - ranges.likesMin) + ranges.likesMin),
      comments: Math.floor(Math.random() * (ranges.commentsMax - ranges.commentsMin) + ranges.commentsMin),
      shares: Math.floor(Math.random() * (ranges.sharesMax - ranges.sharesMin) + ranges.sharesMin),
    });

    const learning = await learningAgent(seedMetrics);

    logInfo("Pipeline completed", { postId: post.id });

    return {
      analysis,
      strategy,
      post,
      learning,
      flow: [
        "analyze past data",
        "decide topic",
        "generate content",
        "generate hooks",
        "optimize post",
        "send preview",
        "publish",
        "track metrics",
        "learn",
      ],
    };
  } catch (error) {
    const type = categorizeError(error);
    logError(type, error.message || "Pipeline failed", "Pipeline failed fast; fallback content can be retried", {
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  runContentPipeline,
};
