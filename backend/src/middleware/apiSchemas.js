const { z } = require("zod");

const topicSchema = z
  .string()
  .trim()
  .min(5, "topic must contain at least 5 characters")
  .max(180, "topic must be 180 characters or fewer")
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/[{}$<>`]/g, "").replace(/\s+/g, " ").trim());

const positiveIntString = z.coerce.number().int().positive();
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const analyticsQuerySchema = paginationSchema.extend({
  sort: z.enum(["created_at_desc", "created_at_asc"]).default("created_at_desc"),
});

const dashboardQuerySchema = paginationSchema.extend({
  postLimit: z.coerce.number().int().min(1).max(50).default(8),
  metricLimit: z.coerce.number().int().min(1).max(90).default(30),
  logLimit: z.coerce.number().int().min(1).max(120).default(40),
});

const logsQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(120).default(50),
  level: z.enum(["all", "info", "warning", "error"]).default("all"),
});

const metricsBodySchema = (maxMetricValue) =>
  z.object({
    post_id: positiveIntString,
    impressions: z.coerce.number().int().min(0).max(maxMetricValue),
    likes: z.coerce.number().int().min(0).max(maxMetricValue),
    comments: z.coerce.number().int().min(0).max(maxMetricValue),
    shares: z.coerce.number().int().min(0).max(maxMetricValue),
  });

const approvalDraftsQuerySchema = z.object({
  status: z
    .enum(["pending_approval", "approved", "published", "rejected", "pending_manual", "generated", "all"])
    .default("pending_approval"),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const approvalGenerateSchema = z.object({
  topic: topicSchema,
});

const approveDraftSchema = z.object({
  postId: positiveIntString,
  approved: z.literal(true),
  content: z.string().trim().max(3000).optional(),
  hook: z.string().trim().max(220).optional(),
  cta: z.string().trim().max(240).optional(),
});

const rejectDraftSchema = z.object({
  postId: positiveIntString,
});

const publishDraftSchema = z.object({
  postId: positiveIntString,
});

module.exports = {
  analyticsQuerySchema,
  approvalDraftsQuerySchema,
  approvalGenerateSchema,
  approveDraftSchema,
  dashboardQuerySchema,
  logsQuerySchema,
  metricsBodySchema,
  publishDraftSchema,
  rejectDraftSchema,
  topicSchema,
};
