const { Pool } = require("pg");
const { loadEnv } = require("../config/env");

let pool = null;
const env = loadEnv();

const memoryDb = {
  posts: [],
  metrics: [],
  logs: [],
};

async function initDatabase() {
  if (!env.databaseUrl) {
    return;
  }

  pool = new Pool({ connectionString: env.databaseUrl });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
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
      cause TEXT,
      fix_applied TEXT,
      details JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

function isPgEnabled() {
  return Boolean(pool);
}

async function savePost(post) {
  if (!isPgEnabled()) {
    const record = {
      id: memoryDb.posts.length + 1,
      created_at: new Date().toISOString(),
      ...post,
    };
    memoryDb.posts.unshift(record);
    return record;
  }

  const result = await pool.query(
    `
      INSERT INTO posts (topic, content, hooks, cta, status)
      VALUES ($1, $2, $3::jsonb, $4, $5)
      RETURNING *
    `,
    [post.topic, post.content, JSON.stringify(post.hooks || []), post.cta || "", post.status]
  );

  return result.rows[0];
}

async function saveMetric(metric) {
  if (!isPgEnabled()) {
    const record = {
      id: memoryDb.metrics.length + 1,
      created_at: new Date().toISOString(),
      ...metric,
    };
    memoryDb.metrics.unshift(record);
    return record;
  }

  const result = await pool.query(
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
  if (!isPgEnabled()) {
    const record = {
      id: memoryDb.logs.length + 1,
      created_at: new Date().toISOString(),
      ...log,
    };
    memoryDb.logs.unshift(record);
    return record;
  }

  const result = await pool.query(
    `
      INSERT INTO logs (level, type, cause, fix_applied, details)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING *
    `,
    [log.level, log.type || "", log.cause || "", log.fix_applied || "", JSON.stringify(log.details || {})]
  );

  return result.rows[0];
}

async function getRecentPosts(limit = 10) {
  if (!isPgEnabled()) {
    return memoryDb.posts.slice(0, limit);
  }

  const result = await pool.query("SELECT * FROM posts ORDER BY created_at DESC LIMIT $1", [limit]);
  return result.rows;
}

async function getRecentMetrics(limit = 20) {
  if (!isPgEnabled()) {
    return memoryDb.metrics.slice(0, limit);
  }

  const result = await pool.query("SELECT * FROM metrics ORDER BY created_at DESC LIMIT $1", [limit]);
  return result.rows;
}

async function getRecentLogs(limit = 50) {
  if (!isPgEnabled()) {
    return memoryDb.logs.slice(0, limit);
  }

  const result = await pool.query("SELECT * FROM logs ORDER BY created_at DESC LIMIT $1", [limit]);
  return result.rows;
}

module.exports = {
  initDatabase,
  savePost,
  saveMetric,
  saveLog,
  getRecentPosts,
  getRecentMetrics,
  getRecentLogs,
};
