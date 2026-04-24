const { Pool } = require("pg");
const { loadEnv } = require("../config/env");

let pool = null;
const env = loadEnv();

function normalizeDatabaseUrl(connectionString) {
  const raw = String(connectionString || "").trim();
  if (!raw) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    const sslMode = String(parsed.searchParams.get("sslmode") || "").trim().toLowerCase();
    const useLibpqCompat = String(parsed.searchParams.get("uselibpqcompat") || "")
      .trim()
      .toLowerCase();

    if (["prefer", "require", "verify-ca"].includes(sslMode) && useLibpqCompat !== "true") {
      parsed.searchParams.set("sslmode", "verify-full");
    }

    return parsed.toString();
  } catch {
    return raw;
  }
}

function requirePool() {
  if (!pool) {
    throw new Error("Database is not initialized. Set DATABASE_URL and restart backend.");
  }

  return pool;
}

function toQueryLimit(value, fallback, max = 100) {
  return Number.isInteger(value) ? Math.max(1, Math.min(value, max)) : fallback;
}

function toQueryOffset(value) {
  return Number.isInteger(value) ? Math.max(0, value) : 0;
}

async function initDatabase() {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required. In-memory fallback has been removed.");
  }

  pool = new Pool({
    connectionString: normalizeDatabaseUrl(env.databaseUrl),
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  await pool.query("SELECT 1");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
      hook TEXT,
      hooks JSONB NOT NULL DEFAULT '[]'::jsonb,
      cta TEXT,
      status TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metrics (
      id SERIAL PRIMARY KEY,
      post_id INT NOT NULL,
      impressions INT NOT NULL DEFAULT 0,
      likes INT NOT NULL DEFAULT 0,
      comments INT NOT NULL DEFAULT 0,
      shares INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
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
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS linkedin_sessions (
      user_id TEXT PRIMARY KEY,
      encrypted_state TEXT NOT NULL,
      profile_name TEXT,
      profile_url TEXT,
      connected_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_validated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS hook TEXT");
  await pool.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()");
  await pool.query("ALTER TABLE logs ADD COLUMN IF NOT EXISTS message TEXT");
  await pool.query("ALTER TABLE linkedin_sessions ADD COLUMN IF NOT EXISTS profile_url TEXT");
  await pool.query("ALTER TABLE linkedin_sessions ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP NOT NULL DEFAULT NOW()");
  await pool.query("ALTER TABLE metrics ALTER COLUMN post_id SET NOT NULL");

  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE metrics
      ADD CONSTRAINT metrics_post_id_fk FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE metrics
      ADD CONSTRAINT metrics_non_negative_values CHECK (
        impressions >= 0 AND likes >= 0 AND comments >= 0 AND shares >= 0
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_metrics_post_id_created_at ON metrics(post_id, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_metrics_created_at ON metrics(created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_linkedin_sessions_updated_at ON linkedin_sessions(updated_at DESC)");
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
    [metric.post_id, metric.impressions || 0, metric.likes || 0, metric.comments || 0, metric.shares || 0]
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

async function getRecentPosts(options = 10) {
  const client = requirePool();
  const normalizedOptions = typeof options === "number" ? { limit: options } : options || {};
  const limit = toQueryLimit(normalizedOptions.limit, 10, 100);
  const offset = toQueryOffset(normalizedOptions.offset);

  const result = await client.query(
    "SELECT * FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return result.rows;
}

async function getPostsByStatus(status, options = 20) {
  const client = requirePool();
  const normalizedOptions = typeof options === "number" ? { limit: options } : options || {};
  const limit = toQueryLimit(normalizedOptions.limit, 20, 100);
  const offset = toQueryOffset(normalizedOptions.offset);
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (!normalizedStatus) {
    return [];
  }

  const result = await client.query(
    "SELECT * FROM posts WHERE LOWER(status) = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    [normalizedStatus, limit, offset]
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
        status = $5,
        updated_at = NOW()
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

async function getRecentMetrics(options = 20) {
  const client = requirePool();
  const normalizedOptions = typeof options === "number" ? { limit: options } : options || {};
  const limit = toQueryLimit(normalizedOptions.limit, 20, 180);
  const offset = toQueryOffset(normalizedOptions.offset);
  const direction = normalizedOptions.sort === "created_at_asc" ? "ASC" : "DESC";

  const result = await client.query(
    `SELECT * FROM metrics ORDER BY created_at ${direction} LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

async function getRecentLogs(options = 50) {
  const client = requirePool();
  const normalizedOptions = typeof options === "number" ? { limit: options } : options || {};
  const limit = toQueryLimit(normalizedOptions.limit, 50, 200);
  const offset = toQueryOffset(normalizedOptions.offset);
  const level = String(normalizedOptions.level || "all").toLowerCase();

  if (level !== "all") {
    const result = await client.query(
      "SELECT * FROM logs WHERE LOWER(level) = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [level, limit, offset]
    );
    return result.rows;
  }

  const result = await client.query(
    "SELECT * FROM logs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return result.rows;
}

async function getLinkedInSession(userId) {
  const client = requirePool();
  const result = await client.query("SELECT * FROM linkedin_sessions WHERE user_id = $1 LIMIT 1", [userId]);
  return result.rows[0] || null;
}

async function upsertLinkedInSession(session) {
  const client = requirePool();
  const result = await client.query(
    `
      INSERT INTO linkedin_sessions (user_id, encrypted_state, profile_name, profile_url, connected_at, last_validated_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        encrypted_state = EXCLUDED.encrypted_state,
        profile_name = EXCLUDED.profile_name,
        profile_url = EXCLUDED.profile_url,
        connected_at = NOW(),
        last_validated_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `,
    [session.userId, session.encryptedState, session.profileName || "", session.profileUrl || ""]
  );

  return result.rows[0] || null;
}

async function touchLinkedInSession(userId) {
  const client = requirePool();
  await client.query(
    "UPDATE linkedin_sessions SET last_validated_at = NOW(), updated_at = NOW() WHERE user_id = $1",
    [userId]
  );
}

async function deleteLinkedInSession(userId) {
  const client = requirePool();
  await client.query("DELETE FROM linkedin_sessions WHERE user_id = $1", [userId]);
}

module.exports = {
  getPostById,
  getPostsByStatus,
  getRecentLogs,
  getRecentMetrics,
  getRecentPosts,
  getLinkedInSession,
  countPublishedPostsSince,
  deleteLinkedInSession,
  findPublishedDuplicateContent,
  initDatabase,
  saveLog,
  saveMetric,
  savePost,
  touchLinkedInSession,
  upsertLinkedInSession,
  updatePostForApproval,
};
