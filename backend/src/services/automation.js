const { loadEnv } = require("../config/env");
const { logInfo } = require("./logger");

const env = loadEnv();
let postsToday = 0;

async function publishToLinkedInSafeMode(postPayload) {
  if (!env.linkedInSafeMode) {
    throw new Error("Safe mode must remain enabled.");
  }

  if (!postPayload?.content?.trim()) {
    return { published: false, reason: "Post content is required for publish request" };
  }

  if (postsToday >= env.linkedInMaxPostsPerDay) {
    return { published: false, reason: "Daily safe-mode limit reached" };
  }

  postsToday += 1;
  logInfo("Safe mode prevented live publish", {
    postsToday,
    contentLength: postPayload.content.trim().length,
  });

  return {
    published: false,
    reason: "Safe mode is enabled. Live posting is skipped; publish manually on LinkedIn.",
  };
}

function resetDailyLimit() {
  postsToday = 0;
}

module.exports = {
  publishToLinkedInSafeMode,
  resetDailyLimit,
};
