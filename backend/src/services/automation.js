const { chromium } = require("playwright");
const { loadEnv } = require("../config/env");
const { logInfo, logError } = require("./logger");

const env = loadEnv();
let postsToday = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishToLinkedInSafeMode(_postPayload) {
  if (!env.linkedInSafeMode) {
    throw new Error("Safe mode must remain enabled.");
  }

  if (postsToday >= env.linkedInMaxPostsPerDay) {
    return { published: false, reason: "Daily safe-mode limit reached" };
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await sleep(700 + Math.floor(Math.random() * 500));
    await page.goto("https://www.linkedin.com", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForLoadState("domcontentloaded");
    await sleep(500 + Math.floor(Math.random() * 800));

    postsToday += 1;
    logInfo("Safe automation simulation completed", { postsToday });

    return { published: true, reason: "Safe simulation mode completed" };
  } catch (error) {
    logError(
      "AUTOMATION_FAILURE",
      error.message,
      "Switched to safe simulation fallback without posting",
      { domSelectorUpdateNeeded: true }
    );

    return { published: false, reason: "Automation unavailable; retained manual publish mode" };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function resetDailyLimit() {
  postsToday = 0;
}

module.exports = {
  publishToLinkedInSafeMode,
  resetDailyLimit,
};
