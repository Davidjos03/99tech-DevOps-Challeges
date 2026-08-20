const express = require("express");
const { Pool } = require("pg");
const Redis = require("ioredis");

const app = express();
const port = Number(process.env.PORT || 3000);

const pool = new Pool({
  host: process.env.DB_HOST || "postgres",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "postgres",
  port: Number(process.env.DB_PORT || 5432),
  max: 10,
  connectionTimeoutMillis: 5000,
});

const redis = new Redis({
  host: process.env.REDIS_HOST || "redis",
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("error", (err) => {
  console.error("Redis error:", err.message);
});

app.get("/api/users", async (req, res) => {
  let db;
  try {
    db = await pool.connect();
    const result = await db.query("SELECT NOW() AS now");
    await redis.set("last_call", Date.now().toString());
    res.json({ ok: true, time: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (db) db.release();
  }
});

app.get("/status", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => console.log(`API running on ${port}`));
