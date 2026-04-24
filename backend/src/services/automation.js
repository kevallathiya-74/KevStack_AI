const { loadEnv } = require("../config/env");
const {
  createLinkedInContextFromSession,
  getDefaultUserId,
  getLinkedInConnectionStatus,
  launchBrowser,
} = require("./connectionService");
const { touchLinkedInSession } = require("./db");
const { logError, logInfo, logProductEvent } = require("./logger");

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

function createRunState(attempt) {
  return {
    attempt,
    step: "init",
    currentUrl: "",
    consoleMessages: [],
    pageErrors: [],
    requestFailures: [],
  };
}

function setStep(state, stepName) {
  state.step = stepName;
}

function toHumanReadablePublishError(errorMessage, stepName) {
  const normalized = String(errorMessage || "").toLowerCase();

  if (
    normalized.includes("linkedin is not connected") ||
    normalized.includes("not connected")
  ) {
    return "Unable to connect LinkedIn. Please try again.";
  }

  if (normalized.includes("session expired")) {
    return "Session expired. Please reconnect LinkedIn.";
  }

  if (
    normalized.includes("executable") ||
    normalized.includes("browser launch") ||
    normalized.includes("chrome") ||
    normalized.includes("msedge") ||
    normalized.includes("playwright") ||
    normalized.includes("chromium")
  ) {
    return "LinkedIn browser could not start. Install Chrome, Edge, or Playwright browsers, then retry.";
  }

  if (
    normalized.includes("verification") ||
    normalized.includes("checkpoint") ||
    normalized.includes("captcha") ||
    normalized.includes("security check") ||
    normalized.includes("two-factor") ||
    normalized.includes("2fa")
  ) {
    return "Session expired. Please reconnect LinkedIn.";
  }

  if (
    normalized.includes("timeout") ||
    normalized.includes("strict mode violation") ||
    normalized.includes("not found") ||
    normalized.includes("locator")
  ) {
    return "LinkedIn UI changed. Please try again.";
  }

  if (normalized.includes("action limit")) {
    return "LinkedIn action limit reached for today. Please retry later.";
  }

  return `LinkedIn posting did not complete at step ${stepName}. Please review and retry.`;
}

function attachDebugListeners(page, state) {
  page.on("console", (msg) => {
    if (state.consoleMessages.length >= 60) {
      state.consoleMessages.shift();
    }

    state.consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
    });
  });

  page.on("pageerror", (error) => {
    if (state.pageErrors.length >= 20) {
      state.pageErrors.shift();
    }

    state.pageErrors.push(String(error?.message || error));
  });

  page.on("requestfailed", (request) => {
    if (state.requestFailures.length >= 30) {
      state.requestFailures.shift();
    }

    state.requestFailures.push({
      url: request.url(),
      method: request.method(),
      errorText: request.failure()?.errorText || "request_failed",
    });
  });
}

async function captureFailureArtifacts(page, state) {
  state.currentUrl = page.url();
  return {
    failedStep: state.step,
    currentUrl: state.currentUrl,
    consoleMessages: state.consoleMessages.slice(-20),
    pageErrors: state.pageErrors.slice(-10),
    requestFailures: state.requestFailures.slice(-10),
  };
}

async function findFirstVisibleLocator(locators, timeoutMs = 10000) {
  let lastError = null;
  for (const locator of locators) {
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return locator;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("LinkedIn selector matching failed");
}

async function ensureLinkedInSession(page, state, userId) {
  setStep(state, "check_session");
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("body", { timeout: 10000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const verificationVisible =
    page.url().includes("/checkpoint") ||
    page.url().includes("/verify") ||
    (await page.getByText(/verification|security check|captcha|checkpoint|two-factor/i).first().isVisible({ timeout: 1800 }).catch(() => false));

  const loginVisible =
    page.url().includes("/login") ||
    (await page.getByRole("button", { name: /^sign in$/i }).first().isVisible({ timeout: 1800 }).catch(() => false));

  if (verificationVisible || loginVisible) {
    const error = new Error("Session expired. Please reconnect LinkedIn.");
    error.code = "session_expired";
    throw error;
  }

  await touchLinkedInSession(userId).catch(() => {});
  setStep(state, "session_active");
}

async function openPostComposer(page, state) {
  setStep(state, "open_feed");
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  setStep(state, "pre_post_scroll");
  await page.mouse.wheel(0, randomInt(250, 900));
  actionsToday += 1;
  await humanDelay(page, 1200, 2200);

  setStep(state, "open_start_post");
  const startPostButton = await findFirstVisibleLocator(
    [
      page.getByRole("button", { name: /start a post/i }).first(),
      page.getByRole("button", { name: /create a post/i }).first(),
      page.getByRole("button", { name: /what do you want to talk about\?/i }).first(),
      page.locator('button[aria-label*="Start a post"]').first(),
      page.locator("button.share-box-feed-entry__trigger").first(),
    ],
    12000
  );

  await startPostButton.click({ timeout: 10000 });
  actionsToday += 1;
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await humanDelay(page, 1200, 2200);
}

async function fillComposerAndSubmit(page, content, state) {
  setStep(state, "wait_composer");
  await page.waitForSelector('div[role="textbox"], div[contenteditable="true"]', { timeout: 15000 });
  const composer = await findFirstVisibleLocator(
    [
      page.locator('div[role="textbox"][aria-multiline="true"]').first(),
      page.locator('div[contenteditable="true"][role="textbox"]').first(),
      page.getByRole("textbox", { name: /text editor/i }).first(),
    ],
    15000
  );

  setStep(state, "type_content");
  await composer.click({ timeout: 10000 });
  const composerContent = String(content || "").trim();

  try {
    await composer.fill(composerContent);
  } catch (_fillError) {
    await page.keyboard.insertText(composerContent);
  }
  actionsToday += 1;
  await humanDelay(page, 1400, 2600);

  setStep(state, "click_post_button");
  const postButton = await findFirstVisibleLocator(
    [
      page.getByRole("button", { name: /^post$/i }).first(),
      page.getByRole("button", { name: /post now/i }).first(),
      page.locator('button[aria-label="Post"]').first(),
      page.locator("button.share-actions__primary-action").first(),
    ],
    10000
  );

  const postResponsePromise = page
    .waitForResponse(
      (response) =>
        response.url().includes("linkedin.com/voyager") &&
        [200, 201, 202].includes(response.status()) &&
        response.request().method() === "POST",
      { timeout: 25000 }
    )
    .catch(() => null);

  await postButton.click({ timeout: 10000 });
  actionsToday += 1;
  await postResponsePromise;
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});

  setStep(state, "publish_verification");
  const publishFailedInline = await page
    .getByText(/couldn't post|unable to post|try again/i)
    .first()
    .isVisible({ timeout: 2500 })
    .catch(() => false);

  if (publishFailedInline) {
    throw new Error("LinkedIn reported a posting error in the composer dialog.");
  }
}

async function publishToLinkedInLiveMode(postPayload) {
  const connection = await getLinkedInConnectionStatus(getDefaultUserId());
  if (!connection.connected) {
    return {
      published: false,
      reason: "Unable to connect LinkedIn. Please try again.",
      mode: "live",
      failedStep: "missing_session",
    };
  }

  let browser = null;
  let context = null;
  let page = null;
  const maxAttempts = 2;
  const userId = getDefaultUserId();

  try {
    try {
      browser = await launchBrowser({ headless: true });
      context = await createLinkedInContextFromSession(browser, userId);
      page = await context.newPage();
    } catch (error) {
      const humanMessage = toHumanReadablePublishError(error?.message, "browser launch");

      logError("AUTOMATION_FAILURE", humanMessage, "Posting failed at step: browser_launch", {
        actionsToday,
        rawError: error?.message || "LinkedIn live publish failed",
      });

      return {
        published: false,
        reason: humanMessage,
        mode: "live",
        failedStep: "browser_launch",
      };
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const state = createRunState(attempt);
      attachDebugListeners(page, state);

      try {
        setStep(state, "attempt_start");
        await humanDelay(page, 900, 1700);
        await ensureLinkedInSession(page, state, userId);
        await openPostComposer(page, state);
        await fillComposerAndSubmit(page, postPayload.content, state);

        logProductEvent("POST_PUBLISHED", "Your post was published successfully on LinkedIn.", "Publishing completed.", {
          status: "success",
          details: {
            mode: "live",
            actionsToday,
            attempt,
          },
        });

        return {
          published: true,
          reason: "Live publish completed on LinkedIn.",
          mode: "live",
          attempts: attempt,
        };
      } catch (error) {
        const details = await captureFailureArtifacts(page, state).catch(() => ({
          failedStep: state.step,
          currentUrl: page.url(),
        }));
        const humanMessage = toHumanReadablePublishError(error?.message, state.step);

        logError(
          "AUTOMATION_FAILURE",
          humanMessage,
          `Posting failed at step: ${state.step}`,
          {
            step: state.step,
            currentUrl: details.currentUrl,
            attempt,
            maxAttempts,
            rawError: error?.message || "unknown_automation_error",
          }
        );

        if (attempt < maxAttempts && !String(error?.message || "").toLowerCase().includes("session expired")) {
          setStep(state, "retry_refresh");
          await page.reload({ waitUntil: "domcontentloaded", timeout: 35000 }).catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
          await humanDelay(page, 2000, 3500).catch(() => {});
          continue;
        }

        return {
          published: false,
          reason: humanMessage,
          mode: "live",
          failedStep: state.step,
          debugArtifact: details,
          attempts: attempt,
        };
      }
    }

    return {
      published: false,
      reason: "LinkedIn posting did not complete after retries.",
      mode: "live",
    };
  } catch (error) {
    logError(
      "AUTOMATION_FAILURE",
      toHumanReadablePublishError(error?.message, "startup"),
      "Posting failed at step: startup",
      {
        actionsToday,
        rawError: error?.message || "LinkedIn live publish failed",
      }
    );

    return {
      published: false,
      reason: toHumanReadablePublishError(error?.message, "startup"),
      mode: "live",
      failedStep: "startup",
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }

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
