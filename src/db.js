const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    encrypted BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    owner_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS job_items (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL,
    data JSONB,
    error TEXT,
    stage_label TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS job_items_job_id_idx ON job_items(job_id);
  CREATE INDEX IF NOT EXISTS jobs_owner_email_idx ON jobs(owner_email);

  -- 'pending' while a storefront's listings are still being discovered in the
  -- background (see jobStore.completeDiscovery) — lets job creation respond
  -- immediately instead of blocking the HTTP request on a scan that can take
  -- minutes for large sellers, which was timing out the reverse proxy. The
  -- discovery_* columns hold what's needed to resume that scan if the server
  -- restarts mid-discovery (see jobStore.findStuckDiscoveries) — otherwise a
  -- redeploy during a long storefront scan would strand the job forever at
  -- 0 items, the same class of bug already fixed for per-item scraping.
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS discovery_status TEXT NOT NULL DEFAULT 'done';
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS discovery_url TEXT;
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS discovery_types TEXT;
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS discovery_mode TEXT;

  -- 'simplified' vs 'full' — lets export pick columns appropriate to what
  -- was actually scanned (simplified items only ever have url+price; the
  -- full per-item field set would just be a wall of empty columns).
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'full';
`;

let migrated = null;

// Each test file runs migrate() from its own process against the same live
// Postgres — concurrent ALTER TABLE ... ADD COLUMN IF NOT EXISTS calls from
// different sessions can genuinely deadlock (Postgres has to catalog-check
// "not exists" while another session holds the same table's DDL lock). An
// advisory lock serializes migration runs across processes so only one
// actually alters the table at a time; everyone else's IF NOT EXISTS is then
// a harmless no-op.
const MIGRATION_LOCK_ID = 84224001;

async function migrate() {
  if (!migrated) {
    migrated = (async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        await client.query(MIGRATIONS);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
        client.release();
      }
    })();
  }
  return migrated;
}

async function query(text, params) {
  await migrate();
  return pool.query(text, params);
}

module.exports = { query, migrate, pool };
