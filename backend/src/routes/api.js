const express = require("express");
const { runContentPipeline } = require("../services/pipeline");
const { publishToLinkedInSafeMode } = require("../services/automation");
const { loadEnv } = require("../config/env");
const { getRecentMetrics, getRecentLogs, getRecentPosts, getPostById, saveMetric } = require("../services/db");
const { transformLogsForFeedback } = require("../services/logFeedback");

const env = loadEnv();
const metricsRateLog = new Map();
const METRICS_RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_METRICS_UPDATES_PER_WINDOW = 2;

function sendSuccess(res, data, status = 200) {
  res.status(status).json({
    success: true,
    data,
    error: null,
  });
}

function createApiError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
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
    performanceContext: result?.performanceContext || null,
    post: result?.post || null,
    flow: result?.flow || [],
  };
}

function createApiRouter() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    sendSuccess(res, { ok: true, module: "api" });
  });

  router.get("/dashboard", async (_req, res, next) => {
    try {
      const [posts, metrics, logs] = await Promise.all([getRecentPosts(5), getRecentMetrics(10), getRecentLogs(10)]);
      sendSuccess(res, { posts, metrics, logs });
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics", async (_req, res, next) => {
    try {
      const metrics = await getRecentMetrics(30);
      sendSuccess(res, { metrics });
    } catch (error) {
      next(error);
    }
  });

  router.post("/metrics", async (req, res, next) => {
    try {
      const postId = Number(req.body?.post_id);
      const impressions = Number(req.body?.impressions ?? 0);
      const likes = Number(req.body?.likes ?? 0);
      const comments = Number(req.body?.comments ?? 0);
      const shares = Number(req.body?.shares ?? 0);

      if (!Number.isInteger(postId) || postId <= 0) {
        next(createApiError(400, "validation_error", "post_id must be a positive integer"));
        return;
      }

      const metricValues = { impressions, likes, comments, shares };
      const hasInvalidMetric = Object.values(metricValues).some(
        (value) => !Number.isInteger(value) || value < 0 || value > env.maxMetricValue
      );
      if (hasInvalidMetric) {
        next(
          createApiError(
            400,
            "validation_error",
            `impressions, likes, comments, and shares must be integers between 0 and ${env.maxMetricValue}`
          )
        );
        return;
      }

      const requestIp = req.ip || req.socket?.remoteAddress || "unknown";
      if (registerMetricWrite(postId, requestIp)) {
        next(
          createApiError(
            429,
            "rate_limit_exceeded",
            "Too many metric updates for this post. Please wait a few minutes and retry."
          )
        );
        return;
      }

      const post = await getPostById(postId);
      if (!post) {
        next(createApiError(404, "validation_error", "Referenced post_id does not exist"));
        return;
      }

      const metric = await saveMetric({
        post_id: postId,
        impressions,
        likes,
        comments,
        shares,
      });

      sendSuccess(res, { metric }, 201);
    } catch (error) {
      next(error);
    }
  });

  router.get("/logs", async (_req, res, next) => {
    try {
      const rawLogs = await getRecentLogs(120);
      const logs = transformLogsForFeedback(rawLogs);
      sendSuccess(res, { logs });
    } catch (error) {
      next(error);
    }
  });

  router.post("/content/generate", async (req, res, next) => {
    try {
      const topic = sanitizeTopic(req.body?.topic);
      if (!topic || topic.length < 5) {
        next(createApiError(400, "validation_error", "topic is required and must contain at least 5 characters"));
        return;
      }

      const result = await runContentPipeline(topic);
      sendSuccess(res, toGenerationPayload(result));
    } catch (error) {
      const mappedError = mapPipelineError(error);
      if (mappedError) {
        next(mappedError);
        return;
      }
      next(error);
    }
  });

  router.post("/content/generate-from-data", async (_req, res, next) => {
    try {
      const [metrics, posts] = await Promise.all([getRecentMetrics(30), getRecentPosts(5)]);
      const topic = buildDataDrivenTopic(metrics, posts);
      if (!topic) {
        next(createApiError(400, "validation_error", "No real posts or metrics found. Add data first, then generate from data."));
        return;
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
    } catch (error) {
      const mappedError = mapPipelineError(error);
      if (mappedError) {
        next(mappedError);
        return;
      }
      next(error);
    }
  });

  router.post("/publish", async (req, res, next) => {
    try {
      const result = await publishToLinkedInSafeMode(req.body || {});
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createApiRouter,
};
