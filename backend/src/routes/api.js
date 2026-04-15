const express = require("express");
const { runContentPipeline } = require("../services/pipeline");
const { publishToLinkedInSafeMode } = require("../services/automation");
const { getRecentMetrics, getRecentLogs, getRecentPosts } = require("../services/db");

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
      const topic = req.body?.topic?.trim() || "system reliability lessons";
      const result = await runContentPipeline(topic);
      res.json(result);
    } catch (error) {
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
