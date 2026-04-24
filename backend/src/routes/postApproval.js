const express = require("express");
const { runContentPipeline } = require("../services/pipeline");
const { publishToLinkedInSafeMode } = require("../services/automation");
const {
  getPostById,
  getPostsByStatus,
  getRecentPosts,
  updatePostForApproval,
  countPublishedPostsSince,
  findPublishedDuplicateContent,
} = require("../services/db");
const { logProductEvent } = require("../services/logger");
const { loadEnv } = require("../config/env");
const { asyncHandler, createApiError, sendSuccess } = require("../lib/http");
const { validate } = require("../lib/validation");
const {
  approvalDraftsQuerySchema,
  approvalGenerateSchema,
  approveDraftSchema,
  publishDraftSchema,
  rejectDraftSchema,
} = require("../middleware/apiSchemas");

const env = loadEnv();

function sanitizeDraftText(value, maxLength) {
  const text = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\r/g, "")
    .trim();

  return text.slice(0, maxLength).trim();
}

function hasUnsafeFormatting(content) {
  const value = String(content || "");
  if (!value.trim()) return true;
  if (value.length > 3000) return true;
  if (/```|^#{1,6}\s|^\s*[-*]{3,}\s*$/m.test(value)) return true;
  return false;
}

function mapPipelineError(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("required for real model inference") || message.includes("missing required environment")) {
    return createApiError(
      503,
      "generation_unavailable",
      "Content generation is temporarily unavailable. Please try again shortly."
    );
  }

  if (message.includes("timeout")) {
    return createApiError(504, "generation_timeout", "Content generation timed out. Please try again with a shorter topic.");
  }

  if (message.includes("quality checks") || message.includes("quality gate")) {
    return createApiError(
      422,
      "quality_gate_failed",
      "Generated content failed quality checks. Please retry with a more specific topic."
    );
  }

  if (message.includes("did not return valid json") || message.includes("unsupported response payload")) {
    return createApiError(502, "generation_unavailable", "Generation service returned an invalid response. Please retry.");
  }

  return null;
}

function startOfUtcDayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function createPostApprovalRouter() {
  const router = express.Router();

  router.post(
    "/generate",
    asyncHandler(async (req, res) => {
      const payload = validate(approvalGenerateSchema, req.body);
      const result = await runContentPipeline(payload.topic);
      const draft = await updatePostForApproval({
        id: result.post.id,
        status: "pending_approval",
      });

      sendSuccess(
        res,
        {
          draft,
          hookScores: result?.hookScores || [],
          flow: result?.flow || [],
        },
        201
      );
    })
  );

  router.get(
    "/drafts",
    asyncHandler(async (req, res) => {
      const query = validate(approvalDraftsQuerySchema, req.query);
      const drafts =
        query.status === "all"
          ? await getRecentPosts({ limit: query.limit, offset: query.offset })
          : await getPostsByStatus(query.status, { limit: query.limit, offset: query.offset });

      sendSuccess(res, { drafts }, 200, { limit: query.limit, offset: query.offset, status: query.status });
    })
  );

  router.post(
    "/approve",
    asyncHandler(async (req, res) => {
      const payload = validate(approveDraftSchema, req.body);
      const existing = await getPostById(payload.postId);
      if (!existing) {
        throw createApiError(404, "validation_error", "Draft not found");
      }

      if (String(existing.status || "").toLowerCase() === "published") {
        throw createApiError(409, "validation_error", "Post is already published");
      }

      const content = payload.content !== undefined ? sanitizeDraftText(payload.content, 3000) : undefined;
      const hook = payload.hook !== undefined ? sanitizeDraftText(payload.hook, 220) : undefined;
      const cta = payload.cta !== undefined ? sanitizeDraftText(payload.cta, 240) : undefined;

      const nextContent = typeof content === "string" ? content : String(existing.content || "").trim();
      if (hasUnsafeFormatting(nextContent)) {
        throw createApiError(400, "validation_error", "Draft content is empty or has unsupported formatting");
      }

      const updated = await updatePostForApproval({
        id: payload.postId,
        content,
        hook,
        cta,
        status: "approved",
      });

      logProductEvent("POST_APPROVED", "Draft approved by user.", "Publishing is now allowed for this draft.", {
        status: "success",
        details: {
          postId: payload.postId,
        },
      });

      sendSuccess(res, { draft: updated });
    })
  );

  router.post(
    "/reject",
    asyncHandler(async (req, res) => {
      const payload = validate(rejectDraftSchema, req.body);
      const existing = await getPostById(payload.postId);
      if (!existing) {
        throw createApiError(404, "validation_error", "Draft not found");
      }

      const updated = await updatePostForApproval({
        id: payload.postId,
        status: "rejected",
      });

      logProductEvent("POST_REJECTED", "Draft rejected by user.", "Generate a new draft to continue.", {
        status: "warning",
        details: {
          postId: payload.postId,
        },
      });

      sendSuccess(res, { draft: updated });
    })
  );

  router.post(
    "/publish",
    asyncHandler(async (req, res) => {
      const payload = validate(publishDraftSchema, req.body);
      const draft = await getPostById(payload.postId);
      if (!draft) {
        throw createApiError(404, "validation_error", "Draft not found");
      }

      if (String(draft.status || "").toLowerCase() !== "approved") {
        throw createApiError(409, "validation_error", "Draft must be approved before publishing");
      }

      if (hasUnsafeFormatting(draft.content)) {
        throw createApiError(400, "validation_error", "Approved content is empty or has unsupported formatting");
      }

      const duplicate = await findPublishedDuplicateContent(draft.content, 96);
      if (duplicate && Number(duplicate.id) !== payload.postId) {
        throw createApiError(
          409,
          "duplicate_post",
          "A similar post was already published recently. Please edit the content before publishing."
        );
      }

      const dailyLimit = Math.max(1, Number(env.linkedInMaxPostsPerDay || 1));
      const publishedToday = await countPublishedPostsSince(startOfUtcDayIso());
      if (publishedToday >= dailyLimit) {
        throw createApiError(429, "rate_limit_exceeded", "Daily posting limit reached. Please publish again tomorrow.");
      }

      const result = await publishToLinkedInSafeMode({
        content: String(draft.content || "").trim(),
      });

      if (!result.published) {
        const isReconnectRequired =
          result.reason === "Session expired. Please reconnect LinkedIn." ||
          result.reason === "Unable to connect LinkedIn. Please try again.";
        const shouldMarkPendingManual = result.mode === "live" && !isReconnectRequired;
        const fallbackDraft = shouldMarkPendingManual
          ? await updatePostForApproval({
              id: payload.postId,
              status: "pending_manual",
            })
          : draft;

        logProductEvent(
          "POST_PUBLISH_FAILED",
          shouldMarkPendingManual
            ? "Auto-post failed. You can post manually."
            : "Posting was skipped due to current safety configuration.",
          `Posting failed at step: ${result.failedStep || "unknown"}`,
          {
            status: "error",
            details: {
              postId: payload.postId,
              reason: result.reason,
              failedStep: result.failedStep || "unknown",
              mode: result.mode || "safe",
              debugArtifact: result.debugArtifact || null,
            },
          }
        );

        sendSuccess(res, {
          published: false,
          reason: isReconnectRequired
            ? result.reason
            : shouldMarkPendingManual
            ? "Auto-post failed. You can post manually."
            : "Posting skipped because safe mode is enabled. You can post manually.",
          rawReason: result.reason,
          mode: result.mode || "safe",
          failedStep: result.failedStep || null,
          draft: fallbackDraft,
        });
        return;
      }

      const updated = await updatePostForApproval({
        id: payload.postId,
        status: "published",
      });

      logProductEvent("POST_PUBLISHED", "Post published successfully", "Publishing completed after explicit approval.", {
        status: "success",
        details: {
          postId: payload.postId,
          mode: result.mode || "live",
        },
      });

      sendSuccess(res, {
        published: true,
        reason: "Post published successfully",
        mode: result.mode || "live",
        draft: updated,
      });
    })
  );

  router.use((error, _req, _res, next) => {
    const mappedError = mapPipelineError(error);
    next(mappedError || error);
  });

  return router;
}

module.exports = {
  createPostApprovalRouter,
};
