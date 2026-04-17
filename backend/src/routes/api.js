const express = require("express");
const { runContentPipeline } = require("../services/pipeline");
const { publishToLinkedInSafeMode } = require("../services/automation");
const { loadEnv } = require("../config/env");
const { getRecentMetrics, getRecentLogs, getRecentPosts, getPostById, saveMetric } = require("../services/db");

const env = loadEnv();

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
    return {
      status: 503,
      body: {
        error: "generation_unavailable",
        message: "Content generation is temporarily unavailable. Please try again shortly.",
      },
    };
  }

  if (message.includes("timeout")) {
    return {
      status: 504,
      body: {
        error: "generation_timeout",
        message: "Content generation timed out. Please try again with a shorter topic.",
      },
    };
  }

  if (message.includes("did not return valid json") || message.includes("unsupported response payload")) {
    return {
      status: 502,
      body: {
        error: "generation_unavailable",
        message: "Generation service returned an invalid response. Please retry.",
      },
    };
  }

  return null;
}

function createApiRouter() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, module: "api" });
  });

  router.get("/dashboard", async (_req, res, next) => {
    try {
      const [posts, metrics, logs] = await Promise.all([getRecentPosts(5), getRecentMetrics(10), getRecentLogs(10)]);
      res.json({ posts, metrics, logs });
    } catch (error) {
      next(error);
    }
  });

  router.get("/analytics", async (_req, res, next) => {
    try {
      const metrics = await getRecentMetrics(30);
      res.json({ metrics });
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
        res.status(400).json({ error: "validation_error", message: "post_id must be a positive integer" });
        return;
      }

      const metricValues = { impressions, likes, comments, shares };
      const hasInvalidMetric = Object.values(metricValues).some(
        (value) => !Number.isInteger(value) || value < 0 || value > env.maxMetricValue
      );
      if (hasInvalidMetric) {
        res.status(400).json({
          error: "validation_error",
          message: `impressions, likes, comments, and shares must be integers between 0 and ${env.maxMetricValue}`,
        });
        return;
      }

      const post = await getPostById(postId);
      if (!post) {
        res.status(404).json({
          error: "validation_error",
          message: "Referenced post_id does not exist",
        });
        return;
      }

      const metric = await saveMetric({
        post_id: postId,
        impressions,
        likes,
        comments,
        shares,
      });

      res.status(201).json({ metric });
    } catch (error) {
      next(error);
    }
  });

  router.get("/logs", async (_req, res, next) => {
    try {
      const logs = await getRecentLogs(50);
      res.json({ logs });
    } catch (error) {
      next(error);
    }
  });

  router.post("/content/generate", async (req, res, next) => {
    try {
      const topic = req.body?.topic?.trim();
      if (!topic) {
        res.status(400).json({ error: "validation_error", message: "topic is required" });
        return;
      }
      const result = await runContentPipeline(topic);
      res.json(result);
    } catch (error) {
      const mappedError = mapPipelineError(error);
      if (mappedError) {
        res.status(mappedError.status).json(mappedError.body);
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
        res.status(400).json({
          error: "validation_error",
          message: "No real posts or metrics found. Add data first, then generate from data.",
        });
        return;
      }

      const result = await runContentPipeline(topic);
      res.json({
        topic,
        source: {
          metricsCount: metrics.length,
          postsCount: posts.length,
        },
        ...result,
      });
    } catch (error) {
      const mappedError = mapPipelineError(error);
      if (mappedError) {
        res.status(mappedError.status).json(mappedError.body);
        return;
      }
      next(error);
    }
  });

  router.post("/publish", async (req, res, next) => {
    try {
      const result = await publishToLinkedInSafeMode(req.body || {});
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createApiRouter,
};
