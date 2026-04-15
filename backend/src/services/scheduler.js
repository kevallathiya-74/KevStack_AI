const cron = require("node-cron");
const { runContentPipeline } = require("./pipeline");
const { publishToLinkedInSafeMode, resetDailyLimit } = require("./automation");
const { logInfo, logError } = require("./logger");

function startScheduler() {
  cron.schedule("0 9 * * *", async () => {
    try {
      const result = await runContentPipeline("engineering delivery systems");
      await publishToLinkedInSafeMode(result.post);
      logInfo("Daily automation cycle completed", { postId: result.post.id });
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
