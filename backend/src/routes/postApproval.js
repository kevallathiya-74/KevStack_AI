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

const env = loadEnv();

function createApiError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sendSuccess(res, data, status = 200) {
  res.status(status).json({
    success: true,
    data,
    error: null,
  });
}

function sanitizeTopic(rawTopic) {
  const topic = String(rawTopic || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!topic) {
    return "";
  }

  return topic.replace(/[{}$<>`]/g, "").slice(0, 180).trim();
}

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

  router.post("/generate", async (req, res, next) => {
    try {
      const topic = sanitizeTopic(req.body?.topic);
      if (!topic || topic.length < 5) {
        next(createApiError(400, "validation_error", "topic is required and must contain at least 5 characters"));
        return;
      }

      const result = await runContentPipeline(topic);
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
    } catch (error) {
      const mappedError = mapPipelineError(error);
      if (mappedError) {
        next(mappedError);
        return;
      }
      next(error);
    }
  });

  router.get("/drafts", async (req, res, next) => {
    try {
      const limit = Number(req.query?.limit || 25);
      const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 25;
      const status = String(req.query?.status || "pending_approval").trim().toLowerCase();

      const drafts = status === "all" ? await getRecentPosts(boundedLimit) : await getPostsByStatus(status, boundedLimit);
      sendSuccess(res, { drafts });
    } catch (error) {
      next(error);
    }
  });

  router.post("/approve", async (req, res, next) => {
    try {
      const postId = Number(req.body?.postId);
      const approved = req.body?.approved === true;

      if (!Number.isInteger(postId) || postId <= 0) {
        next(createApiError(400, "validation_error", "postId must be a positive integer"));
        return;
      }

      if (!approved) {
        next(createApiError(400, "validation_error", "approved must be true before publish"));
        return;
      }

      const existing = await getPostById(postId);
      if (!existing) {
        next(createApiError(404, "validation_error", "Draft not found"));
        return;
      }

      if (String(existing.status || "").toLowerCase() === "published") {
        next(createApiError(409, "validation_error", "Post is already published"));
        return;
      }

      const content = req.body?.content !== undefined ? sanitizeDraftText(req.body.content, 3000) : undefined;
      const hook = req.body?.hook !== undefined ? sanitizeDraftText(req.body.hook, 220) : undefined;
      const cta = req.body?.cta !== undefined ? sanitizeDraftText(req.body.cta, 240) : undefined;

      const nextContent = typeof content === "string" ? content : String(existing.content || "").trim();
      if (hasUnsafeFormatting(nextContent)) {
        next(createApiError(400, "validation_error", "Draft content is empty or has unsupported formatting"));
        return;
      }

      const updated = await updatePostForApproval({
        id: postId,
        content,
        hook,
        cta,
        status: "approved",
      });

      logProductEvent("POST_APPROVED", "Draft approved by user.", "Publishing is now allowed for this draft.", {
        status: "success",
        details: {
          postId,
        },
      });

      sendSuccess(res, { draft: updated });
    } catch (error) {
      next(error);
    }
  });

  router.post("/reject", async (req, res, next) => {
    try {
      const postId = Number(req.body?.postId);
      if (!Number.isInteger(postId) || postId <= 0) {
        next(createApiError(400, "validation_error", "postId must be a positive integer"));
        return;
      }

      const existing = await getPostById(postId);
      if (!existing) {
        next(createApiError(404, "validation_error", "Draft not found"));
        return;
      }

      const updated = await updatePostForApproval({
        id: postId,
        status: "rejected",
      });

      logProductEvent("POST_REJECTED", "Draft rejected by user.", "Generate a new draft to continue.", {
        status: "warning",
        details: {
          postId,
        },
      });

      sendSuccess(res, { draft: updated });
    } catch (error) {
      next(error);
    }
  });

  router.post("/publish", async (req, res, next) => {
    try {
      const postId = Number(req.body?.postId);
      if (!Number.isInteger(postId) || postId <= 0) {
        next(createApiError(400, "validation_error", "postId must be a positive integer"));
        return;
      }

      const draft = await getPostById(postId);
      if (!draft) {
        next(createApiError(404, "validation_error", "Draft not found"));
        return;
      }

      if (String(draft.status || "").toLowerCase() !== "approved") {
        next(createApiError(409, "validation_error", "Draft must be approved before publishing"));
        return;
      }

      if (hasUnsafeFormatting(draft.content)) {
        next(createApiError(400, "validation_error", "Approved content is empty or has unsupported formatting"));
        return;
      }

      const duplicate = await findPublishedDuplicateContent(draft.content, 96);
      if (duplicate && Number(duplicate.id) !== postId) {
        next(
          createApiError(
            409,
            "duplicate_post",
            "A similar post was already published recently. Please edit the content before publishing."
          )
        );
        return;
      }

      const dailyLimit = Math.max(1, Number(env.linkedInMaxPostsPerDay || 1));
      const publishedToday = await countPublishedPostsSince(startOfUtcDayIso());
      if (publishedToday >= dailyLimit) {
        next(createApiError(429, "rate_limit_exceeded", "Daily posting limit reached. Please publish again tomorrow."));
        return;
      }

      const result = await publishToLinkedInSafeMode({
        content: String(draft.content || "").trim(),
      });

      if (!result.published) {
        const shouldMarkPendingManual = result.mode === "live";
        const fallbackDraft = shouldMarkPendingManual
          ? await updatePostForApproval({
              id: postId,
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
              postId,
              reason: result.reason,
              failedStep: result.failedStep || "unknown",
              mode: result.mode || "safe",
              debugArtifact: result.debugArtifact || null,
            },
          }
        );

        sendSuccess(res, {
          published: false,
          reason: shouldMarkPendingManual
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
        id: postId,
        status: "published",
      });

      logProductEvent("POST_PUBLISHED", "Post published successfully", "Publishing completed after explicit approval.", {
        status: "success",
        details: {
          postId,
          mode: result.mode || "live",
        },
      });

      sendSuccess(res, {
        published: true,
        reason: "Post published successfully",
        mode: result.mode || "live",
        draft: updated,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createPostApprovalRouter,
};
