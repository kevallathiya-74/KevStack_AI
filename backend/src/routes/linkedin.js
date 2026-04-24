const express = require("express");
const { asyncHandler, createApiError, sendSuccess } = require("../lib/http");
const {
  connectLinkedInAccount,
  disconnectLinkedInAccount,
  getDefaultUserId,
  getLinkedInConnectionStatus,
} = require("../services/connectionService");

function createLinkedInRouter() {
  const router = express.Router();

  router.get(
    "/status",
    asyncHandler(async (_req, res) => {
      const status = await getLinkedInConnectionStatus(getDefaultUserId());
      sendSuccess(res, status);
    })
  );

  router.post(
    "/connect",
    asyncHandler(async (_req, res) => {
      try {
        const result = await connectLinkedInAccount({ userId: getDefaultUserId() });
        sendSuccess(res, result);
      } catch (error) {
        if (error?.code === "linkedin_verification_required") {
          throw createApiError(
            409,
            "linkedin_verification_required",
            "LinkedIn asked for additional verification. Complete it in the opened browser window, then click Connect LinkedIn again.",
            {
              reason: error?.message || "verification_required",
            }
          );
        }

        if (error?.code === "linkedin_login_timeout") {
          throw createApiError(408, "linkedin_login_timeout", "LinkedIn login timed out. Please try Connect LinkedIn again.", {
            reason: error?.message || "login_timeout",
          });
        }

        throw createApiError(503, "linkedin_connect_failed", "Unable to connect LinkedIn. Please try again.", {
          reason: error?.message || "unknown_connection_error",
        });
      }
    })
  );

  router.post(
    "/disconnect",
    asyncHandler(async (_req, res) => {
      const result = await disconnectLinkedInAccount(getDefaultUserId());
      sendSuccess(res, result);
    })
  );

  return router;
}

module.exports = {
  createLinkedInRouter,
};
