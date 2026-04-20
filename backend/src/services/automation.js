const { chromium } = require("playwright");
const { loadEnv } = require("../config/env");
const { logInfo, logError, logProductEvent } = require("./logger");

const env = loadEnv();
let postsToday = 0;
let actionsToday = 0;

function randomInt(min, max) {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function ensureActionBudget() {
  if (actionsToday >= env.linkedInMaxActionsPerDay) {
    throw new Error("Daily LinkedIn action limit reached.");
  }
}

async function humanDelay(page, minMs = 2000, maxMs = 5000) {
  ensureActionBudget();
  const delay = randomInt(minMs, maxMs);
  await page.waitForTimeout(delay);
  actionsToday += 1;
}

async function clickFirstMatching(page, selectors, timeout = 8000) {
  let lastError = null;
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout });
      await locator.click({ timeout });
      actionsToday += 1;
      return selector;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("LinkedIn selector matching failed");
}

async function publishToLinkedInLiveMode(postPayload) {
  if (!env.linkedInEmail || !env.linkedInPassword) {
    logProductEvent(
      "AUTOMATION_FAILURE",
      "Posting could not start because LinkedIn credentials are missing.",
      "Add LinkedIn credentials to enable live posting.",
      { status: "error" }
    );

    return {
      published: false,
      reason: "LINKEDIN_EMAIL and LINKEDIN_PASSWORD are required for live publishing.",
      mode: "live",
    };
  }

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();

    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 45000 });
    await humanDelay(page);

    await page.locator("#username").fill("");
    await page.locator("#username").pressSequentially(env.linkedInEmail, { delay: randomInt(40, 110) });
    actionsToday += 1;
    await humanDelay(page);

    await page.locator("#password").fill("");
    await page.locator("#password").pressSequentially(env.linkedInPassword, { delay: randomInt(45, 120) });
    actionsToday += 1;
    await humanDelay(page);

    await clickFirstMatching(page, ['button[type="submit"]', 'button[aria-label="Sign in"]']);
    await page.waitForLoadState("networkidle", { timeout: 45000 });
    await humanDelay(page);

    await page.mouse.wheel(0, randomInt(300, 900));
    actionsToday += 1;
    await humanDelay(page);

    await clickFirstMatching(page, [
      'button[aria-label*="Start a post"]',
      'button.share-box-feed-entry__trigger',
      'button[data-control-name="sharebox_trigger"]',
    ]);
    await humanDelay(page);

    const composer = page
      .locator('div[role="textbox"][aria-multiline="true"], div[contenteditable="true"][role="textbox"]')
      .first();
    await composer.waitFor({ state: "visible", timeout: 10000 });
    await composer.click();
    await page.keyboard.type(postPayload.content.trim(), { delay: randomInt(25, 70) });
    actionsToday += 1;
    await humanDelay(page, 2200, 3800);

    await clickFirstMatching(page, ['button[aria-label="Post"]', 'button.share-actions__primary-action']);
    await page.waitForLoadState("networkidle", { timeout: 30000 });

    logProductEvent("POST_PUBLISHED", "Your post was published successfully on LinkedIn.", "Publishing completed.", {
      status: "success",
      details: {
        mode: "live",
        actionsToday,
      },
    });

    return {
      published: true,
      reason: "Live publish completed on LinkedIn.",
      mode: "live",
    };
  } catch (error) {
    logError(
      "AUTOMATION_FAILURE",
      error?.message || "LinkedIn live publish failed",
      "Selector fallback and retries applied; manual publish may be required",
      {
        actionsToday,
      }
    );

    return {
      published: false,
      reason: `LinkedIn live publish failed: ${error?.message || "unknown automation error"}`,
      mode: "live",
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function publishToLinkedInSafeMode(postPayload) {
  if (!postPayload?.content?.trim()) {
    return { published: false, reason: "Post content is required for publish request" };
  }

  if (postsToday >= env.linkedInMaxPostsPerDay) {
    return { published: false, reason: "Daily safe-mode limit reached" };
  }

  postsToday += 1;

  if (env.linkedInSafeMode || !env.linkedInPublishEnabled) {
    logInfo("Safe mode prevented live publish", {
      postsToday,
      actionsToday,
      contentLength: postPayload.content.trim().length,
      publishEnabled: env.linkedInPublishEnabled,
    });

    logProductEvent(
      "POST_READY",
      "Your post is ready. Live publishing is currently disabled.",
      "Publish manually or enable live mode.",
      {
        status: "warning",
        details: {
          mode: "safe",
          postsToday,
          actionsToday,
        },
      }
    );

    return {
      published: false,
      reason: env.linkedInSafeMode
        ? "Safe mode is enabled. Live posting is skipped; publish manually on LinkedIn."
        : "Live publish is disabled by LINKEDIN_PUBLISH_ENABLED=false.",
      mode: "safe",
      postsToday,
      actionsToday,
    };
  }

  const result = await publishToLinkedInLiveMode(postPayload);
  return {
    ...result,
    postsToday,
    actionsToday,
  };
}

function resetDailyLimit() {
  postsToday = 0;
  actionsToday = 0;
}

module.exports = {
  publishToLinkedInSafeMode,
  resetDailyLimit,
};
