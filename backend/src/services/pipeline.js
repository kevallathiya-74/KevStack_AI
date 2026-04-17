const {
  analyzerAgent,
  strategyAgent,
  contentGeneratorAgent,
  hookGeneratorAgent,
  engagementAgent,
  learningAgent,
} = require("./agents");
const { savePost, getRecentMetrics, getRecentPosts } = require("./db");
const { logInfo, logError } = require("./logger");

function categorizeError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("module") || message.includes("depend")) return "DEPENDENCY_ISSUE";
  if (message.includes("timeout") || message.includes("api") || message.includes("network")) return "API_FAILURE";
  if (message.includes("quality")) return "API_FAILURE";
  if (message.includes("selector") || message.includes("playwright") || message.includes("automation")) {
    return "AUTOMATION_FAILURE";
  }
  return "UI_CRASH";
}

function validateGeneratedPostQuality(content, hooks, cta) {
  const issues = [];
  const postText = String(content || "").trim();
  const ctaText = String(cta || "").trim();
  const hookList = Array.isArray(hooks) ? hooks : [];

  if (postText.length < 180) {
    issues.push("content is too short");
  }

  if (postText.length > 3000) {
    issues.push("content is too long");
  }

  const paragraphCount = postText
    .split(/\n\s*\n/)
    .map((segment) => segment.trim())
    .filter(Boolean).length;
  if (paragraphCount < 4) {
    issues.push("content is not structured into readable paragraphs");
  }

  if (/^#{1,6}\s|\*\*|```/m.test(postText)) {
    issues.push("content includes markdown artifacts");
  }

  const hashtags = postText.match(/#[A-Za-z0-9_]+/g) || [];
  if (hashtags.length < 3) {
    issues.push("content is missing enough hashtags");
  }

  if (hookList.length !== 3) {
    issues.push("exactly 3 hooks are required");
  }

  if (hookList.some((hook) => String(hook || "").trim().length < 10)) {
    issues.push("hooks are too short");
  }

  if (ctaText.length < 10) {
    issues.push("cta is too short");
  }

  return issues;
}

function buildPerformanceContext(recentMetrics, recentPosts) {
  const totals = recentMetrics.reduce(
    (acc, metric) => {
      acc.impressions += Number(metric.impressions || 0);
      acc.likes += Number(metric.likes || 0);
      acc.comments += Number(metric.comments || 0);
      acc.shares += Number(metric.shares || 0);
      return acc;
    },
    { impressions: 0, likes: 0, comments: 0, shares: 0 }
  );

  const metricCount = recentMetrics.length;
  const latestMetric = recentMetrics[0] || null;
  const oldestMetric = recentMetrics[metricCount - 1] || null;

  const averages =
    metricCount > 0
      ? {
          impressions: Math.round(totals.impressions / metricCount),
          likes: Math.round(totals.likes / metricCount),
          comments: Math.round(totals.comments / metricCount),
          shares: Math.round(totals.shares / metricCount),
        }
      : null;

  const trends =
    metricCount > 1
      ? {
          impressionsDelta:
            Number(latestMetric?.impressions || 0) - Number(oldestMetric?.impressions || 0),
          likesDelta: Number(latestMetric?.likes || 0) - Number(oldestMetric?.likes || 0),
        }
      : null;

  return {
    metricSamples: metricCount,
    postSamples: recentPosts.length,
    totals,
    averages,
    trends,
    latestMetric: latestMetric
      ? {
          impressions: Number(latestMetric.impressions || 0),
          likes: Number(latestMetric.likes || 0),
          comments: Number(latestMetric.comments || 0),
          shares: Number(latestMetric.shares || 0),
          created_at: latestMetric.created_at,
        }
      : null,
    latestPostTopics: recentPosts
      .map((post) => String(post.topic || "").trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}

async function runContentPipeline(topic) {
  try {
    logInfo("Pipeline started", { topic });

    const [recentMetrics, recentPosts] = await Promise.all([getRecentMetrics(30), getRecentPosts(5)]);
    const performanceContext = buildPerformanceContext(recentMetrics, recentPosts);

    const analysis = await analyzerAgent(topic, performanceContext);
    const strategy = await strategyAgent(topic, analysis, performanceContext);
    const content = await contentGeneratorAgent(topic, strategy, performanceContext);
    const { hooks, cta } = await hookGeneratorAgent(topic, content);
    const mergedContent = await engagementAgent(topic, content, hooks);

    const qualityIssues = validateGeneratedPostQuality(mergedContent, hooks, cta);
    if (qualityIssues.length) {
      throw new Error(`Generated content failed quality checks: ${qualityIssues.join("; ")}`);
    }

    const post = await savePost({
      topic,
      content: mergedContent,
      hooks,
      cta,
      status: "generated",
    });

    let learning = null;
    if (recentMetrics.length) {
      learning = await learningAgent({
        samples: performanceContext.metricSamples,
        averages: performanceContext.averages,
        totals: performanceContext.totals,
        trends: performanceContext.trends,
      });
    }

    logInfo("Pipeline completed", { postId: post.id });

    return {
      analysis,
      strategy,
      post,
      learning,
      performanceContext,
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
    logError(type, error.message || "Pipeline failed", "Pipeline failed fast; retry after dependency or API fix", {
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  runContentPipeline,
};
