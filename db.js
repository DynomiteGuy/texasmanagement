const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      hr_role_id TEXT,
      dmotw_message TEXT,
      dmotw_channel_id TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shifts (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      adjustment_seconds INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function getActiveShift(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM shifts WHERE guild_id=$1 AND user_id=$2 AND start_time IS NOT NULL AND end_time IS NULL LIMIT 1`,
    [guildId, userId]
  );
  return rows[0] || null;
}

async function startShift(guildId, userId) {
  await pool.query(`INSERT INTO shifts (guild_id, user_id, start_time) VALUES ($1, $2, NOW())`, [
    guildId,
    userId,
  ]);
}

async function endShift(guildId, userId) {
  await pool.query(
    `UPDATE shifts SET end_time = NOW()
     WHERE id = (SELECT id FROM shifts WHERE guild_id=$1 AND user_id=$2 AND start_time IS NOT NULL AND end_time IS NULL LIMIT 1)`,
    [guildId, userId]
  );
}

async function adjustShift(guildId, userId, seconds) {
  await pool.query(`INSERT INTO shifts (guild_id, user_id, adjustment_seconds) VALUES ($1, $2, $3)`, [
    guildId,
    userId,
    seconds,
  ]);
}

async function getTotalSeconds(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))), 0) AS session_seconds,
       COALESCE(SUM(adjustment_seconds), 0) AS adjustment_seconds
     FROM shifts
     WHERE guild_id=$1 AND user_id=$2 AND (end_time IS NOT NULL OR adjustment_seconds != 0)`,
    [guildId, userId]
  );
  const row = rows[0];
  return Math.round(Number(row.session_seconds) + Number(row.adjustment_seconds));
}

async function getLeaderboard(guildId, limit = 10) {
  const { rows } = await pool.query(
    `SELECT user_id,
       COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))), 0) +
       COALESCE(SUM(adjustment_seconds), 0) AS total_seconds
     FROM shifts
     WHERE guild_id=$1
     GROUP BY user_id
     ORDER BY total_seconds DESC
     LIMIT $2`,
    [guildId, limit]
  );
  return rows.map((r) => ({ userId: r.user_id, totalSeconds: Math.round(Number(r.total_seconds)) }));
}

async function getGuildConfig(guildId) {
  const { rows } = await pool.query(`SELECT * FROM guild_config WHERE guild_id=$1`, [guildId]);
  return rows[0] || null;
}

async function upsertGuildConfig(guildId, fields) {
  const existing = await getGuildConfig(guildId);
  if (existing) {
    const keys = Object.keys(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await pool.query(`UPDATE guild_config SET ${setClause} WHERE guild_id=$1`, [
      guildId,
      ...keys.map((k) => fields[k]),
    ]);
  } else {
    const keys = ['guild_id', ...Object.keys(fields)];
    const values = [guildId, ...Object.values(fields)];
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    await pool.query(`INSERT INTO guild_config (${keys.join(', ')}) VALUES (${placeholders})`, values);
  }
}

module.exports = {
  init,
  getActiveShift,
  startShift,
  endShift,
  adjustShift,
  getTotalSeconds,
  getLeaderboard,
  getGuildConfig,
  upsertGuildConfig,
};
