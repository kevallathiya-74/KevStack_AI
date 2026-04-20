const cron = require("node-cron");
const { runContentPipeline } = require("./pipeline");
const { publishToLinkedInSafeMode, resetDailyLimit } = require("./automation");
const { logInfo, logError, logProductEvent } = require("./logger");
const { getRecentPosts, getRecentMetrics } = require("./db");
const { loadEnv } = require("../config/env");

const env = loadEnv();
const RETRY_DELAYS_MS = [0, 5 * 60 * 1000, 15 * 60 * 1000];
let schedulerCycleActive = false;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deriveSchedulerTopic(recentMetrics, recentPosts) {
  const latestPostTopic = String(recentPosts[0]?.topic || "").trim();
  if (!latestPostTopic) {
    return {
      topic: env.defaultSchedulerTopic,
      strategy: "fallback_default",
      reason: "No recent posts found; using default scheduler topic.",
    };
  }

  if (!recentMetrics.length) {
    return {
      topic: latestPostTopic,
      strategy: "reuse_last_topic",
      reason: "No recent metrics found; reusing latest post topic.",
    };
  }

  const totals = recentMetrics.reduce(
    (acc, metric) => {
      acc.impressions += Number(metric.impressions || 0);
      acc.comments += Number(metric.comments || 0);
      acc.shares += Number(metric.shares || 0);
      return acc;
    },
    { impressions: 0, comments: 0, shares: 0 }
  );

  const averages = {
    impressions: Math.round(totals.impressions / recentMetrics.length),
    comments: Math.round(totals.comments / recentMetrics.length),
    shares: Math.round(totals.shares / recentMetrics.length),
  };

  const latestMetric = recentMetrics[0];
  const latestComments = Number(latestMetric.comments || 0);
  const latestImpressions = Number(latestMetric.impressions || 0);
  const latestShares = Number(latestMetric.shares || 0);

  if (latestComments > averages.comments) {
    return {
      topic: latestPostTopic,
      strategy: "repeat_topic",
      reason: "Latest comments are above average; repeating the topic.",
    };
  }

  if (latestImpressions < averages.impressions) {
    return {
      topic: `hook optimization for \"${latestPostTopic}\" from low-impression post data`,
      strategy: "improve_hook",
      reason: "Latest impressions are below average; using a hook optimization variant.",
    };
  }

  if (latestShares > averages.shares && latestShares > 0) {
    return {
      topic: `${latestPostTopic} part 2`,
      strategy: "convert_to_series",
      reason: "Latest shares are above average; converting topic into a series.",
    };
  }

  return {
    topic: latestPostTopic,
    strategy: "maintain_direction",
    reason: "Signals are stable; maintaining current topic direction.",
  };
}

async function runScheduledCycle() {
  if (schedulerCycleActive) {
    logInfo("Scheduler skipped overlapping cycle");
    return;
  }

  schedulerCycleActive = true;
  try {
    const [recentPosts, recentMetrics] = await Promise.all([getRecentPosts(3), getRecentMetrics(30)]);
    const nextTopic = deriveSchedulerTopic(recentMetrics, recentPosts);

    if (["improve_hook", "convert_to_series", "repeat_topic"].includes(nextTopic.strategy)) {
      logProductEvent(
        "IMPROVEMENT_APPLIED",
        "Automatic strategy tuning was applied using recent performance signals.",
        "Next content topic updated automatically.",
        {
          status: "warning",
          details: {
            strategy: nextTopic.strategy,
            reason: nextTopic.reason,
            topic: nextTopic.topic,
          },
        }
      );
    }

    let lastError = null;

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      const delayMs = RETRY_DELAYS_MS[attempt];
      if (delayMs > 0) {
        logInfo("Scheduler retry backoff waiting", { attempt: attempt + 1, delayMs });
        logProductEvent(
          "RETRY_ATTEMPT",
          "A temporary issue occurred while running automation.",
          "Retrying automatically.",
          {
            status: "warning",
            details: {
              attempt: attempt + 1,
              delayMs,
            },
          }
        );
        await wait(delayMs);
      }

      try {
        const result = await runContentPipeline(nextTopic.topic);
        const publishResult = await publishToLinkedInSafeMode(result.post);
        logInfo("Daily automation cycle completed", {
          postId: result.post.id,
          topic: nextTopic.topic,
          strategy: nextTopic.strategy,
          strategyReason: nextTopic.reason,
          published: publishResult.published,
          reason: publishResult.reason,
          retryAttempt: attempt + 1,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        logError(
          "API_FAILURE",
          error.message || "Scheduler task failed",
          attempt < RETRY_DELAYS_MS.length - 1
            ? "Scheduler retry queued with backoff"
            : "Scheduler retries exhausted for this cycle",
          { attempt: attempt + 1, topic: nextTopic.topic }
        );
      }
    }

    if (lastError) {
      throw lastError;
    }
  } finally {
    schedulerCycleActive = false;
  }
}

function startScheduler() {
  cron.schedule("0 9 * * *", async () => {
    try {
      await runScheduledCycle();
    } catch (error) {
      logError("API_FAILURE", error.message || "Scheduler task failed", "Scheduler will retry at next cycle");
    }
  });

  cron.schedule("0 0 * * *", () => {
    resetDailyLimit();
    logInfo("Daily automation post limit reset");
  });

  logInfo("Scheduler initialized", {
    jobs: ["daily pipeline at 09:00", "daily reset at 00:00"],
    retries: RETRY_DELAYS_MS.length,
  });
}

module.exports = {
  startScheduler,
};
