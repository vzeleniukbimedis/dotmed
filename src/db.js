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
`;

let migrated = null;

async function migrate() {
  if (!migrated) {
    migrated = pool.query(MIGRATIONS);
  }
  return migrated;
}

async function query(text, params) {
  await migrate();
  return pool.query(text, params);
}

module.exports = { query, migrate, pool };
