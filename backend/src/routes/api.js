const express = require("express");
const { loadEnv } = require("../config/env");
const {
  analyticsQuerySchema,
  approvalGenerateSchema,
  dashboardQuerySchema,
  logsQuerySchema,
  metricsBodySchema,
} = require("../middleware/apiSchemas");
const { asyncHandler, createApiError, sendSuccess } = require("../lib/http");
const { validate } = require("../lib/validation");
const { createLinkedInRouter } = require("./linkedin");
const { createPostApprovalRouter } = require("./postApproval");
const { getRecentMetrics, getRecentLogs, getRecentPosts, getPostById, saveMetric } = require("../services/db");
const { getLinkedInConnectionStatus, getDefaultUserId } = require("../services/connectionService");
const { transformLogsForFeedback } = require("../services/logFeedback");
const { runContentPipeline } = require("../services/pipeline");

const env = loadEnv();
const metricsRateLog = new Map();
const METRICS_RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_METRICS_UPDATES_PER_WINDOW = 2;

function registerMetricWrite(postId, requestIp) {
  const key = `${postId}:${requestIp || "unknown"}`;
  const now = Date.now();
  const recentWrites = (metricsRateLog.get(key) || []).filter((timestamp) => now - timestamp < METRICS_RATE_WINDOW_MS);

  if (recentWrites.length >= MAX_METRICS_UPDATES_PER_WINDOW) {
    return true;
  }

  recentWrites.push(now);
  metricsRateLog.set(key, recentWrites);
  return false;
}

function normalizeBaseTopic(rawTopic) {
  let topic = String(rawTopic || "").trim();
  if (!topic) {
    return "";
  }

  for (let i = 0; i < 4; i += 1) {
    const reviewMatch = topic.match(/^content review and next-step strategy for "(.+)"$/i);
    if (reviewMatch) {
      topic = reviewMatch[1].trim();
      continue;
    }

    const performanceMatch = topic.match(
      /^performance update for "(.+)" with \d+ impressions, \d+ likes, \d+ comments, and \d+ shares$/i
    );
    if (performanceMatch) {
      topic = performanceMatch[1].trim();
      continue;
    }

    break;
  }

  return topic.replace(/"/g, "'");
}

function buildDataDrivenTopic(metrics, posts) {
  const latestMetric = metrics[0] || null;
  const latestPost = posts[0] || null;
  const baseTopic = normalizeBaseTopic(latestPost?.topic);

  if (latestMetric && baseTopic) {
    return `performance update for "${baseTopic}" with ${latestMetric.impressions} impressions, ${latestMetric.likes} likes, ${latestMetric.comments} comments, and ${latestMetric.shares} shares`;
  }

  if (baseTopic) {
    return `content review and next-step strategy for "${baseTopic}"`;
  }

  return null;
}

function mapPipelineError(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("required for real model inference") || message.includes("missing required environment")) {
    return createApiError(503, "generation_unavailable", "Content generation is temporarily unavailable. Please try again shortly.");
  }

  if (message.includes("timeout")) {
    return createApiError(504, "generation_timeout", "Content generation timed out. Please try again with a shorter topic.");
  }

  if (message.includes("quality checks") || message.includes("quality gate")) {
    return createApiError(422, "quality_gate_failed", "Generated content failed quality checks. Please retry with a more specific topic.");
  }

  if (message.includes("did not return valid json") || message.includes("unsupported response payload")) {
    return createApiError(502, "generation_unavailable", "Generation service returned an invalid response. Please retry.");
  }

  return null;
}

function toGenerationPayload(result) {
  const latestMetric = result?.performanceContext?.latestMetric || {};

  return {
    hook: result?.post?.hook || result?.selectedHook || result?.post?.hooks?.[0] || "",
    content: result?.post?.content || "",
    cta: result?.post?.cta || "",
    topic: result?.post?.topic || "",
    metrics: {
      impressions: Number(latestMetric.impressions || 0),
      likes: Number(latestMetric.likes || 0),
      comments: Number(latestMetric.comments || 0),
    },
    hooks: result?.post?.hooks || [],
    hookScores: result?.hookScores || [],
    analysis: result?.analysis || null,
    strategy: result?.strategy || null,
    learning: result?.learning || null,
    growthDecision: result?.growthDecision || null,
    performanceContext: result?.performanceContext || null,
    post: result?.post || null,
    flow: result?.flow || [],
  };
}

function createApiRouter(options = {}) {
  const router = express.Router();
  const contentGenerationLimiter = options.contentGenerationLimiter;

  router.use("/approval", createPostApprovalRouter());
  router.use("/linkedin", createLinkedInRouter());

  router.get("/health", (_req, res) => {
    sendSuccess(res, { ok: true, module: "api", version: "v1" });
  });

  router.get(
    "/dashboard",
    asyncHandler(async (req, res) => {
      const query = validate(dashboardQuerySchema, req.query);
      const [posts, metrics, logs] = await Promise.all([
        getRecentPosts({ limit: query.postLimit, offset: query.offset }),
        getRecentMetrics({ limit: query.metricLimit, offset: query.offset }),
        getRecentLogs({ limit: query.logLimit, offset: query.offset }),
      ]);

      sendSuccess(
        res,
        { posts, metrics, logs },
        200,
        {
          limit: query.limit,
          offset: query.offset,
        }
      );
    })
  );

  router.get(
    "/analytics",
    asyncHandler(async (req, res) => {
      const query = validate(analyticsQuerySchema, req.query);
      const metrics = await getRecentMetrics({ limit: query.limit, offset: query.offset, sort: query.sort });
      sendSuccess(res, { metrics }, 200, { limit: query.limit, offset: query.offset, sort: query.sort });
    })
  );

  router.get("/settings", asyncHandler(async (_req, res) => {
    const linkedInConnection = await getLinkedInConnectionStatus(getDefaultUserId());
    sendSuccess(res, {
      safeMode: env.linkedInSafeMode,
      publishEnabled: env.linkedInPublishEnabled,
      maxPostsPerDay: env.linkedInMaxPostsPerDay,
      maxActionsPerDay: env.linkedInMaxActionsPerDay,
      defaultSchedulerTopic: env.defaultSchedulerTopic,
      huggingFaceConfigured: Boolean(env.huggingFaceApiToken),
      linkedInConnection,
    });
  }));

  router.post(
    "/metrics",
    asyncHandler(async (req, res) => {
      const payload = validate(metricsBodySchema(env.maxMetricValue), req.body);
      const requestIp = req.ip || req.socket?.remoteAddress || "unknown";

      if (registerMetricWrite(payload.post_id, requestIp)) {
        throw createApiError(
          429,
          "rate_limit_exceeded",
          "Too many metric updates for this post. Please wait a few minutes and retry."
        );
      }

      const post = await getPostById(payload.post_id);
      if (!post) {
        throw createApiError(404, "validation_error", "Referenced post_id does not exist");
      }

      const metric = await saveMetric(payload);
      sendSuccess(res, { metric }, 201);
    })
  );

  router.get(
    "/logs",
    asyncHandler(async (req, res) => {
      const query = validate(logsQuerySchema, req.query);
      const rawLogs = await getRecentLogs({ limit: query.limit, offset: query.offset, level: query.level });
      const logs = transformLogsForFeedback(rawLogs);
      sendSuccess(res, { logs }, 200, { limit: query.limit, offset: query.offset, level: query.level });
    })
  );

  router.post(
    "/content/generate",
    contentGenerationLimiter,
    asyncHandler(async (req, res) => {
      const payload = validate(approvalGenerateSchema, req.body);
      const result = await runContentPipeline(payload.topic);
      sendSuccess(res, toGenerationPayload(result));
    })
  );

  router.post(
    "/content/generate-from-data",
    contentGenerationLimiter,
    asyncHandler(async (_req, res) => {
      const [metrics, posts] = await Promise.all([getRecentMetrics(30), getRecentPosts(5)]);
      const topic = buildDataDrivenTopic(metrics, posts);
      if (!topic) {
        throw createApiError(400, "validation_error", "No real posts or metrics found. Add data first, then generate from data.");
      }

      const result = await runContentPipeline(topic);
      sendSuccess(res, {
        ...toGenerationPayload(result),
        topic,
        source: {
          metricsCount: metrics.length,
          postsCount: posts.length,
        },
      });
    })
  );

  router.post("/publish", (_req, _res, next) => {
    next(
      createApiError(
        409,
        "approval_required",
        "Direct publishing is disabled. Approve draft first and use /api/approval/publish."
      )
    );
  });

  router.use((error, _req, _res, next) => {
    const mappedError = mapPipelineError(error);
    next(mappedError || error);
  });

  return router;
}

module.exports = {
  createApiRouter,
};
