const {
  analyzerAgent,
  strategyAgent,
  contentGeneratorAgent,
  hookGeneratorAgent,
  scoreHooks,
  selectBestHook,
  ctaGeneratorAgent,
  engagementAgent,
  learningAgent,
} = require("./agents");
const { savePost, getRecentMetrics, getRecentPosts } = require("./db");
const { logInfo, logError, logProductEvent } = require("./logger");

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
  const wordCount = postText.split(/\s+/).filter(Boolean).length;
  const genericPhrasePattern =
    /in (today'?s|the modern) (world|landscape)|game changer|leverage synergy|unlock potential|disrupt the industry/i;

  if (wordCount < 200) {
    issues.push("content is too short; minimum 200 words required");
  }

  if (postText.length > 3000) {
    issues.push("content is too long");
  }

  const paragraphCount = postText
    .split(/\n\s*\n/)
    .map((segment) => segment.trim())
    .filter(Boolean).length;
  if (paragraphCount < 6) {
    issues.push("content is not structured into hook/story/problem/insight/action/cta sections");
  }

  if (/^#{1,6}\s|\*\*|```/m.test(postText)) {
    issues.push("content includes markdown artifacts");
  }

  if (genericPhrasePattern.test(postText)) {
    issues.push("content contains generic phrasing");
  }

  const openingLines = postText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  if (openingLines.length < 25 || !/[!?]/.test(openingLines)) {
    issues.push("first two lines do not form a clear hook");
  }

  const hashtags = postText.match(/#[A-Za-z0-9_]+/g) || [];
  if (hashtags.length < 3) {
    issues.push("content is missing enough hashtags");
  }

  if (hookList.length < 5) {
    issues.push("at least 5 hooks are required for ranking");
  }

  if (hookList.some((hook) => String(hook || "").trim().length < 10)) {
    issues.push("hooks are too short");
  }

  if (ctaText.length < 10 || !ctaText.endsWith("?")) {
    issues.push("cta must be a meaningful question");
  }

  return issues;
}

function buildGrowthDecision(performanceContext, recentPosts) {
  const latestTopic = String(recentPosts?.[0]?.topic || "").trim();
  if (!latestTopic || !performanceContext?.averages || !performanceContext?.latestMetric) {
    return {
      strategy: "insufficient_signal",
      reason: "Not enough historical data to derive growth loop decision.",
      recommendedTopic: latestTopic || null,
    };
  }

  const averageComments = Number(performanceContext.averages.comments || 0);
  const averageImpressions = Number(performanceContext.averages.impressions || 0);
  const averageShares = Number(performanceContext.averages.shares || 0);
  const latestComments = Number(performanceContext.latestMetric.comments || 0);
  const latestImpressions = Number(performanceContext.latestMetric.impressions || 0);
  const latestShares = Number(performanceContext.latestMetric.shares || 0);

  if (latestComments > averageComments) {
    return {
      strategy: "repeat_topic",
      reason: "Latest comments exceeded average comments; repeat and deepen the winning topic.",
      recommendedTopic: latestTopic,
    };
  }

  if (latestImpressions < averageImpressions) {
    return {
      strategy: "improve_hook",
      reason: "Latest impressions are below average; keep topic and strengthen the opening hook.",
      recommendedTopic: `hook optimization for \"${latestTopic}\" from low-impression post data`,
    };
  }

  if (latestShares > averageShares && latestShares > 0) {
    return {
      strategy: "convert_to_series",
      reason: "Latest shares are above average; expand this topic into a series.",
      recommendedTopic: `${latestTopic} part 2`,
    };
  }

  return {
    strategy: "maintain",
    reason: "Signals are stable; continue with the same topic direction.",
    recommendedTopic: latestTopic,
  };
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
    const growthDecision = buildGrowthDecision(performanceContext, recentPosts);

    const analysis = await analyzerAgent(topic, performanceContext);
    const strategy = await strategyAgent(topic, analysis, performanceContext);
    const content = await contentGeneratorAgent(topic, strategy, performanceContext);
    const { hooks } = await hookGeneratorAgent(topic, content);
    const hookScores = scoreHooks(hooks, topic);
    const selectedHook = selectBestHook(hookScores);
    const rankedHooks = hookScores.map((item) => item.hook);

    logProductEvent("HOOK_OPTIMIZED", "Hook options were scored to maximize engagement.", "Top-performing hook selected.", {
      status: "success",
      details: {
        topScore: Number(hookScores[0]?.score || 0),
        hookCount: hookScores.length,
      },
    });

    const cta = await ctaGeneratorAgent(topic, content, selectedHook);
    const mergedContent = await engagementAgent(topic, content, selectedHook, cta);

    const qualityIssues = validateGeneratedPostQuality(mergedContent, rankedHooks, cta);
    if (qualityIssues.length) {
      throw new Error(`Generated content failed quality checks: ${qualityIssues.join("; ")}`);
    }

    const post = await savePost({
      topic,
      content: mergedContent,
      hook: selectedHook,
      hooks: rankedHooks,
      cta,
      status: "generated",
    });

    logProductEvent(
      "CONTENT_GENERATED",
      "Your LinkedIn post has been generated successfully with optimized structure.",
      "Ready for publishing",
      {
        status: "success",
        details: {
          postId: post.id,
          topic,
        },
      }
    );

    logProductEvent("POST_READY", "Your post is ready for review.", "Open Content Studio to edit or publish.", {
      status: "success",
      details: {
        postId: post.id,
      },
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

    if (["improve_hook", "convert_to_series", "repeat_topic"].includes(growthDecision.strategy)) {
      logProductEvent(
        "IMPROVEMENT_APPLIED",
        "Performance insights were applied to improve the next content cycle.",
        "Optimization strategy updated automatically.",
        {
          status: "warning",
          details: {
            strategy: growthDecision.strategy,
            reason: growthDecision.reason,
            recommendedTopic: growthDecision.recommendedTopic,
          },
        }
      );
    }

    logInfo("Pipeline completed", { postId: post.id });

    return {
      analysis,
      strategy,
      post,
      selectedHook,
      hookScores,
      learning,
      growthDecision,
      performanceContext,
      flow: [
        "analyze past data",
        "build strategy",
        "generate content (mistral)",
        "generate hooks (flan)",
        "score hooks",
        "select best hook",
        "generate cta (flan)",
        "validate quality gate",
        "save post",
        "learn from metrics",
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
