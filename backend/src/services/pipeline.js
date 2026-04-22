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

const FALLBACK_HASHTAG_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "before",
  "being",
  "between",
  "books",
  "career",
  "from",
  "have",
  "into",
  "just",
  "lessons",
  "learned",
  "more",
  "next",
  "people",
  "review",
  "story",
  "strategy",
  "their",
  "there",
  "these",
  "they",
  "this",
  "topic",
  "with",
  "your",
]);

function normalizeCaptionTopic(topic) {
  return String(topic || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[{}$<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackHashtags(topic) {
  const topicWords = normalizeCaptionTopic(topic)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !FALLBACK_HASHTAG_STOPWORDS.has(word));

  const tags = [...new Set(topicWords)].slice(0, 3).map((word) => `#${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  const fallbackTags = ["#Learning", "#Growth", "#Career", "#Insight", "#Mindset"];

  for (const tag of fallbackTags) {
    if (tags.length >= 5) {
      break;
    }

    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return tags.slice(0, 5);
}

function buildFallbackCaption(topic, analysis, strategy, performanceContext, selectedHook, cta) {
  const topicText = normalizeCaptionTopic(topic) || "this topic";
  const audience = String(analysis?.audience || "professionals").trim() || "professionals";
  const painPoint = String(analysis?.painPoint || "turning theory into something useful").trim() || "turning theory into something useful";
  const angle = String(analysis?.angle || "making the lesson practical").trim() || "making the lesson practical";
  const storyArc = Array.isArray(strategy?.storyArc)
    ? strategy.storyArc.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4)
    : [];

  const hookSource = String(selectedHook || "").trim();
  const hookLine = hookSource.length >= 25
    ? `${hookSource.replace(/[.!?]+$/u, "")}${/[!?]$/.test(hookSource) ? "" : "?"}`
    : `If ${topicText} has ever felt bigger than the books, where do you start?`;
  const hookFollowUp = "The useful part appears when you turn it into something you can explain and use in a real decision.";
  const story = `Story: when I first looked at ${topicText}, I treated it like something I would just memorize and move past. The moment it became useful was when I connected it to a real situation, because that is when the details started to make sense instead of feeling abstract.`;
  const storyTwo = storyArc.length
    ? `That shift usually follows a path like ${storyArc.join(" -> ")}.`
    : "That shift usually happens in small steps: curiosity, confusion, practice, and then clarity.";
  const problem = `Problem: most people get stuck because the subject feels too broad at first. They collect notes, repeat definitions, and still cannot explain what changes in practice for ${audience}.`;
  const problemTwo = "Without a simple structure, even a good idea stays trapped in a summary instead of turning into something usable.";
  const insight = `Insight: the best way to handle ${topicText} is to separate the idea, the mistake it prevents, and the result it creates. When you do that, ${painPoint} becomes easier to solve and ${angle} becomes easier to remember.`;
  const insightTwo = Number(performanceContext?.metricSamples || 0) > 0
    ? "If you are also looking at what performs well, keep the lesson concrete enough that it can be explained in one sentence and repeated without jargon."
    : "Keep the explanation concrete enough that someone else can repeat it without jargon.";
  const action = `Action: the next time you revisit ${topicText}, write one sentence on what it means, one sentence on where it breaks, and one sentence on how you would apply it in a real project, class, or conversation.`;
  const actionTwo = "If you can teach it back in plain language, you are much closer to understanding it for real.";
  const ctaText = `${String(cta || "").trim().replace(/[\s?]+$/u, "") || `What is the most practical lesson ${topicText} has taught you so far`}?`;
  const hashtags = buildFallbackHashtags(topicText);

  return [
    `${hookLine}\n${hookFollowUp}`,
    `${story} ${storyTwo}`,
    `${problem} ${problemTwo}`,
    `${insight} ${insightTwo}`,
    `${action} ${actionTwo}`,
    `${ctaText} ${hashtags.join(" ")}`,
  ].join("\n\n");
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
    let finalContent = mergedContent;
    if (qualityIssues.length) {
      finalContent = buildFallbackCaption(topic, analysis, strategy, performanceContext, selectedHook, cta);
      logProductEvent(
        "IMPROVEMENT_APPLIED",
        "Generated content did not meet the quality gate. A structured fallback caption was built automatically.",
        "Fallback caption applied.",
        {
          status: "warning",
          details: {
            topic,
            issues: qualityIssues,
          },
        }
      );
    }

    const fallbackQualityIssues = validateGeneratedPostQuality(finalContent, rankedHooks, cta);
    if (fallbackQualityIssues.length) {
      throw new Error(`Generated content failed quality checks: ${fallbackQualityIssues.join("; ")}`);
    }

    const post = await savePost({
      topic,
      content: finalContent,
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
