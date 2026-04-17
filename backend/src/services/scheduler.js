const cron = require("node-cron");
const { runContentPipeline } = require("./pipeline");
const { publishToLinkedInSafeMode, resetDailyLimit } = require("./automation");
const { logInfo, logError } = require("./logger");
const { getRecentPosts } = require("./db");
const { loadEnv } = require("../config/env");

const env = loadEnv();

function startScheduler() {
  cron.schedule("0 9 * * *", async () => {
    try {
      const recentPosts = await getRecentPosts(1);
      const topic = recentPosts[0]?.topic?.trim() || env.defaultSchedulerTopic;
      if (!recentPosts[0]) {
        logInfo("Scheduler fallback topic applied", { topic });
      }

      const result = await runContentPipeline(topic);
      const publishResult = await publishToLinkedInSafeMode(result.post);
      logInfo("Daily automation cycle completed", {
        postId: result.post.id,
        topic,
        published: publishResult.published,
        reason: publishResult.reason,
      });
    } catch (error) {
      logError("API_FAILURE", error.message || "Scheduler task failed", "Scheduler will retry at next cycle");
    }
  });

  cron.schedule("0 0 * * *", () => {
    resetDailyLimit();
    logInfo("Daily automation post limit reset");
  });

  logInfo("Scheduler initialized", { jobs: ["daily pipeline at 09:00", "daily reset at 00:00"] });
}

module.exports = {
  startScheduler,
};
