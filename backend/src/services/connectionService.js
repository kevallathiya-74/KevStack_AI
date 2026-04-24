const { chromium } = require("playwright");
const { loadEnv } = require("../config/env");
const {
  deleteLinkedInSession,
  getLinkedInSession,
  upsertLinkedInSession,
} = require("./db");
const { decryptJson, encryptJson } = require("./sessionManager");
const { logError, logInfo, logProductEvent } = require("./logger");

const env = loadEnv();

function getDefaultUserId() {
  return String(env.defaultAppUserId || "local-user").trim() || "local-user";
}

async function launchBrowser(options = {}) {
  const launchOptions = [
    { headless: options.headless ?? true },
    { headless: options.headless ?? true, channel: "chrome" },
    { headless: options.headless ?? true, channel: "msedge" },
  ];
  let lastError = null;

  for (const config of launchOptions) {
    try {
      return await chromium.launch(config);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to launch a browser for LinkedIn integration. ${String(lastError?.message || lastError || "Unknown browser launch error")}`
  );
}

async function extractProfile(page) {
  const profileName = await page
    .locator('a[href*="/in/"] span[aria-hidden="true"], .profile-card-member-details__content h3, h1')
    .first()
    .textContent()
    .catch(() => "");
  const profileLink = await page
    .locator('a[href*="/in/"]')
    .first()
    .getAttribute("href")
    .catch(() => "");

  return {
    profileName: String(profileName || "").replace(/\s+/g, " ").trim() || "LinkedIn User",
    profileUrl: profileLink ? new URL(profileLink, "https://www.linkedin.com").toString() : "",
  };
}

async function waitForManualLogin(page, timeoutMs) {
  const start = Date.now();
  let verificationSeen = false;

  while (Date.now() - start < timeoutMs) {
    const currentUrl = page.url();
    const normalizedUrl = String(currentUrl || "").toLowerCase();
    const onFeed = normalizedUrl.includes("/feed");
    const onVerification =
      normalizedUrl.includes("/checkpoint") ||
      normalizedUrl.includes("/challenge") ||
      normalizedUrl.includes("/verify");
    if (onVerification) {
      verificationSeen = true;
    }

    const authenticatedCookiePresent = await page
      .context()
      .cookies("https://www.linkedin.com")
      .then((cookies) => cookies.some((cookie) => cookie.name === "li_at" || cookie.name === "JSESSIONID"))
      .catch(() => false);

    const feedVisible = await page
      .getByRole("button", { name: /start a post|create a post/i })
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    const profileVisible = await page
      .locator('a[href*="/in/"]')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);

    if (onFeed && (feedVisible || profileVisible || authenticatedCookiePresent)) {
      return;
    }

    await page.waitForTimeout(1500);
  }

  if (verificationSeen) {
    const error = new Error(
      "LinkedIn verification is still pending. Complete it in the opened browser and then press Connect LinkedIn again."
    );
    error.code = "linkedin_verification_required";
    throw error;
  }

  const error = new Error("Timed out waiting for LinkedIn login to complete.");
  error.code = "linkedin_login_timeout";
  throw error;
}

async function connectLinkedInAccount(options = {}) {
  const userId = String(options.userId || getDefaultUserId());
  const timeoutMs = Number(env.linkedInConnectTimeoutMs || 180000);
  let browser = null;
  let context = null;

  try {
    browser = await launchBrowser({ headless: false });
    context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();

    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForManualLogin(page, timeoutMs);

    const storageState = await context.storageState();
    const profile = await extractProfile(page);
    await upsertLinkedInSession({
      userId,
      encryptedState: encryptJson(storageState),
      profileName: profile.profileName,
      profileUrl: profile.profileUrl,
    });

    logProductEvent(
      "LINKEDIN_CONNECTED",
      "LinkedIn session connected successfully.",
      "Session encrypted and saved for approved publishing.",
      {
        status: "success",
        details: {
          userId,
          profileName: profile.profileName,
        },
      }
    );

    return {
      connected: true,
      profileName: profile.profileName,
      profileUrl: profile.profileUrl,
      connectedAt: new Date().toISOString(),
    };
  } catch (error) {
    logError(
      "AUTOMATION_FAILURE",
      error?.message || "Unable to connect LinkedIn session",
      "Retry LinkedIn connection flow",
      { userId }
    );
    throw error;
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function getLinkedInConnectionStatus(userId = getDefaultUserId()) {
  const session = await getLinkedInSession(userId);
  if (!session) {
    return {
      connected: false,
      profileName: "",
      profileUrl: "",
      connectedAt: null,
      lastValidatedAt: null,
    };
  }

  return {
    connected: true,
    profileName: session.profile_name || "",
    profileUrl: session.profile_url || "",
    connectedAt: session.connected_at || null,
    lastValidatedAt: session.last_validated_at || null,
  };
}

async function disconnectLinkedInAccount(userId = getDefaultUserId()) {
  await deleteLinkedInSession(userId);
  logInfo("LinkedIn session disconnected", { userId });
  return { connected: false };
}

async function createLinkedInContextFromSession(browser, userId = getDefaultUserId()) {
  const session = await getLinkedInSession(userId);
  if (!session?.encrypted_state) {
    const error = new Error("LinkedIn is not connected. Please connect LinkedIn before publishing.");
    error.code = "linkedin_not_connected";
    throw error;
  }

  let storageState;
  try {
    storageState = decryptJson(session.encrypted_state);
  } catch (_error) {
    const error = new Error("Session expired. Please reconnect LinkedIn.");
    error.code = "session_expired";
    throw error;
  }

  return browser.newContext({
    viewport: { width: 1366, height: 768 },
    storageState,
  });
}

module.exports = {
  connectLinkedInAccount,
  createLinkedInContextFromSession,
  disconnectLinkedInAccount,
  getDefaultUserId,
  getLinkedInConnectionStatus,
  launchBrowser,
};
