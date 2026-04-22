const { Pool } = require("pg");
const { loadEnv } = require("../config/env");

let pool = null;
const env = loadEnv();

function requirePool() {
  if (!pool) {
    throw new Error("Database is not initialized. Set DATABASE_URL and restart backend.");
  }

  return pool;
}

async function initDatabase() {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required. In-memory fallback has been removed.");
  }

  pool = new Pool({ connectionString: env.databaseUrl });
  await pool.query("SELECT 1");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
      hook TEXT,
      hooks JSONB NOT NULL,
      cta TEXT,
      status TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metrics (
      id SERIAL PRIMARY KEY,
      post_id INT,
      impressions INT DEFAULT 0,
      likes INT DEFAULT 0,
      comments INT DEFAULT 0,
      shares INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      level TEXT NOT NULL,
      type TEXT,
      message TEXT,
      cause TEXT,
      fix_applied TEXT,
      details JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS hook TEXT");
  await pool.query("ALTER TABLE logs ADD COLUMN IF NOT EXISTS message TEXT");

  await pool.query("CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_metrics_post_id ON metrics(post_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_metrics_created_at ON metrics(created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC)");
}

async function savePost(post) {
  const client = requirePool();
  const normalizedHooks = Array.isArray(post.hooks) ? post.hooks : [];
  const primaryHook = String(post.hook || normalizedHooks[0] || "").trim();

  const result = await client.query(
    `
      INSERT INTO posts (topic, content, hook, hooks, cta, status)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6)
      RETURNING *
    `,
    [post.topic, post.content, primaryHook, JSON.stringify(normalizedHooks), post.cta || "", post.status]
  );

  return result.rows[0];
}

async function saveMetric(metric) {
  const client = requirePool();

  const result = await client.query(
    `
      INSERT INTO metrics (post_id, impressions, likes, comments, shares)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [metric.post_id || null, metric.impressions || 0, metric.likes || 0, metric.comments || 0, metric.shares || 0]
  );

  return result.rows[0];
}

async function saveLog(log) {
  const client = requirePool();
  const message = String(log.message || log.cause || "").trim();

  const result = await client.query(
    `
      INSERT INTO logs (level, type, message, cause, fix_applied, details)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING *
    `,
    [log.level, log.type || "", message, log.cause || "", log.fix_applied || "", JSON.stringify(log.details || {})]
  );

  return result.rows[0];
}

async function getRecentPosts(limit = 10) {
  const client = requirePool();

  const result = await client.query("SELECT * FROM posts ORDER BY created_at DESC LIMIT $1", [limit]);
  return result.rows;
}

async function getPostsByStatus(status, limit = 20) {
  const client = requirePool();

  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (!normalizedStatus) {
    return [];
  }

  const result = await client.query(
    "SELECT * FROM posts WHERE LOWER(status) = $1 ORDER BY created_at DESC LIMIT $2",
    [normalizedStatus, limit]
  );
  return result.rows;
}

async function getPostById(id) {
  const client = requirePool();
  const result = await client.query("SELECT * FROM posts WHERE id = $1 LIMIT 1", [id]);
  return result.rows[0] || null;
}

async function updatePostForApproval(input) {
  const client = requirePool();
  const result = await client.query(
    `
      UPDATE posts
      SET
        content = COALESCE($2, content),
        hook = COALESCE($3, hook),
        cta = COALESCE($4, cta),
        status = $5
      WHERE id = $1
      RETURNING *
    `,
    [
      input.id,
      typeof input.content === "string" ? input.content : null,
      typeof input.hook === "string" ? input.hook : null,
      typeof input.cta === "string" ? input.cta : null,
      input.status,
    ]
  );

  return result.rows[0] || null;
}

async function countPublishedPostsSince(sinceIsoDate) {
  const client = requirePool();
  const result = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM posts
      WHERE LOWER(status) = 'published' AND created_at >= $1
    `,
    [sinceIsoDate]
  );

  return Number(result.rows[0]?.count || 0);
}

async function findPublishedDuplicateContent(content, withinHours = 72) {
  const client = requirePool();
  const normalizedContent = String(content || "").trim().toLowerCase();
  if (!normalizedContent) {
    return null;
  }

  const hours = Number.isInteger(withinHours) ? Math.max(1, withinHours) : 72;
  const result = await client.query(
    `
      SELECT id, created_at
      FROM posts
      WHERE LOWER(status) = 'published'
        AND LOWER(TRIM(content)) = $1
        AND created_at >= NOW() - (($2::text || ' hours')::interval)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalizedContent, hours]
  );

  return result.rows[0] || null;
}

async function getRecentMetrics(limit = 20) {
  const client = requirePool();

  const result = await client.query("SELECT * FROM metrics ORDER BY created_at DESC LIMIT $1", [limit]);
  return result.rows;
}

async function getRecentLogs(limit = 50) {
  const client = requirePool();

  const result = await client.query("SELECT * FROM logs ORDER BY created_at DESC LIMIT $1", [limit]);
  return result.rows;
}

module.exports = {
  initDatabase,
  savePost,
  saveMetric,
  saveLog,
  getRecentPosts,
  getPostsByStatus,
  getPostById,
  updatePostForApproval,
  countPublishedPostsSince,
  findPublishedDuplicateContent,
  getRecentMetrics,
  getRecentLogs,
};
