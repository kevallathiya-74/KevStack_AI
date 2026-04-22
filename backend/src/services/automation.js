const { chromium } = require("playwright");
const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const { loadEnv } = require("../config/env");
const { logInfo, logError, logProductEvent } = require("./logger");

const env = loadEnv();
let postsToday = 0;
let actionsToday = 0;
const automationArtifactRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "KevStack_AI", "automation");
const linkedInAuthStatePath = path.join(automationArtifactRoot, "linkedin-storage-state.json");

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

async function launchLinkedInBrowser() {
  const launchOptions = [{ headless: true }, { headless: true, channel: "chrome" }, { headless: true, channel: "msedge" }];
  let lastError = null;

  for (const options of launchOptions) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to launch a browser for LinkedIn publishing. ${String(lastError?.message || lastError || "Unknown browser launch error")}`
  );
}

async function createLinkedInContext(browser) {
  const baseOptions = { viewport: { width: 1366, height: 768 } };

  try {
    await fs.access(linkedInAuthStatePath);
    try {
      return await browser.newContext({ ...baseOptions, storageState: linkedInAuthStatePath });
    } catch (error) {
      logInfo("LinkedIn auth state could not be loaded; starting fresh session.", {
        rawError: error?.message || "unknown_storage_state_error",
      });
    }
  } catch (_error) {
    // No saved LinkedIn session yet.
  }

  return browser.newContext(baseOptions);
}

async function saveLinkedInAuthState(context) {
  await fs.mkdir(path.dirname(linkedInAuthStatePath), { recursive: true });
  await context.storageState({ path: linkedInAuthStatePath });
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
    normalized.includes("executable") ||
    normalized.includes("browser launch") ||
    normalized.includes("chrome") ||
    normalized.includes("msedge") ||
    normalized.includes("playwright") ||
    normalized.includes("chromium")
  ) {
    return "LinkedIn browser could not start. Install Chrome, Edge, or Playwright browsers, then retry.";
  }

  if (normalized.includes("credentials") || normalized.includes("login")) {
    return "LinkedIn login session expired. Re-authentication is required.";
  }

  if (
    normalized.includes("verification") ||
    normalized.includes("checkpoint") ||
    normalized.includes("captcha") ||
    normalized.includes("security check") ||
    normalized.includes("two-factor") ||
    normalized.includes("2fa")
  ) {
    return "LinkedIn requires manual verification before posting. Complete the sign-in challenge, then retry.";
  }

  if (
    normalized.includes("timeout") ||
    normalized.includes("strict mode violation") ||
    normalized.includes("not found") ||
    normalized.includes("locator")
  ) {
    return "LinkedIn UI changed. System is updating automatically.";
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
  const timestamp = Date.now();
  const screenshotPath = path.join(automationArtifactRoot, `linkedin-failure-${timestamp}-attempt-${state.attempt}.png`);
  const debugPath = path.join(automationArtifactRoot, `linkedin-failure-${timestamp}-attempt-${state.attempt}.json`);

  await fs.mkdir(automationArtifactRoot, { recursive: true });
  state.currentUrl = page.url();

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await fs
    .writeFile(
      debugPath,
      JSON.stringify(
        {
          failedStep: state.step,
          currentUrl: state.currentUrl,
          consoleMessages: state.consoleMessages,
          pageErrors: state.pageErrors,
          requestFailures: state.requestFailures,
        },
        null,
        2
      ),
      "utf8"
    )
    .catch(() => {});

  return {
    screenshotPath,
    debugPath,
    failedStep: state.step,
    currentUrl: state.currentUrl,
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

async function ensureLinkedInSession(page, state, context) {
  setStep(state, "check_session");
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("body", { timeout: 10000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const verificationVisible =
    page.url().includes("/checkpoint") ||
    page.url().includes("/verify") ||
    (await page.getByText(/verification|security check|captcha|checkpoint|two-factor/i).first().isVisible({ timeout: 1800 }).catch(() => false));

  if (verificationVisible) {
    throw new Error("LinkedIn requires manual verification before posting.");
  }

  const emailInput = page.getByLabel(/email or phone/i).first();
  const passwordInput = page.getByLabel(/password/i).first();
  const loginVisible =
    page.url().includes("/login") ||
    (await emailInput.isVisible({ timeout: 1800 }).catch(() => false)) ||
    (await passwordInput.isVisible({ timeout: 1800 }).catch(() => false));

  if (!loginVisible) {
    setStep(state, "session_active");
    return;
  }

  if (!env.linkedInEmail || !env.linkedInPassword) {
    throw new Error("LinkedIn credentials are missing for re-login.");
  }

  setStep(state, "login_email");
  await emailInput.waitFor({ state: "visible", timeout: 12000 });
  await emailInput.fill("");
  await emailInput.pressSequentially(env.linkedInEmail, { delay: randomInt(45, 110) });
  actionsToday += 1;
  await humanDelay(page, 900, 1700);

  setStep(state, "login_password");
  await passwordInput.waitFor({ state: "visible", timeout: 12000 });
  await passwordInput.fill("");
  await passwordInput.pressSequentially(env.linkedInPassword, { delay: randomInt(45, 120) });
  actionsToday += 1;
  await humanDelay(page, 900, 1700);

  setStep(state, "login_submit");
  await page.getByRole("button", { name: /^sign in$/i }).first().click({ timeout: 10000 });
  actionsToday += 1;

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const stillOnLogin =
    page.url().includes("/login") ||
    (await page.getByRole("button", { name: /^sign in$/i }).first().isVisible({ timeout: 1800 }).catch(() => false)) ||
    (await page.getByText(/verification|security check|captcha|checkpoint|two-factor/i).first().isVisible({ timeout: 1800 }).catch(() => false));

  if (stillOnLogin) {
    throw new Error("LinkedIn login session could not be established.");
  }

  await saveLinkedInAuthState(context).catch(() => {});
  setStep(state, "session_recovered");
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
  let context = null;
  let page = null;
  const maxAttempts = 3;

  try {
    try {
      browser = await launchLinkedInBrowser();
      context = await createLinkedInContext(browser);
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
        await ensureLinkedInSession(page, state, context);
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
            screenshotPath: details.screenshotPath,
            debugPath: details.debugPath,
            attempt,
            maxAttempts,
            rawError: error?.message || "unknown_automation_error",
          }
        );

        if (attempt < maxAttempts) {
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
