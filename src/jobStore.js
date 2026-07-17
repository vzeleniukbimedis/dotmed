const crypto = require('crypto');
const db = require('./db');

function toItem(row) {
  const item = { url: row.url, status: row.status };
  if (row.data) item.data = row.data;
  if (row.error) item.error = row.error;
  if (row.stage_label) item.stageLabel = row.stage_label;
  if (row.started_at) item.startedAt = row.started_at.toISOString();
  if (row.finished_at) item.finishedAt = row.finished_at.toISOString();
  Object.defineProperty(item, '__id', { value: row.id, enumerable: false });
  return item;
}

async function createJob(entries, ownerEmail) {
  const id = crypto.randomUUID();
  const createdAt = new Date();

  await db.query('INSERT INTO jobs (id, owner_email, created_at) VALUES ($1, $2, $3)', [id, ownerEmail, createdAt]);

  const items = [];
  for (let position = 0; position < entries.length; position++) {
    const entry = entries[position];
    // `data` lets a caller pre-fill an already-known result (e.g. the
    // simplified storefront scan, which reads title/price straight off the
    // seller's page) so the item never gets queued for a per-item scrape.
    const { url, error, data } = typeof entry === 'string' ? { url: entry } : entry;
    const itemId = crypto.randomUUID();
    const status = error ? 'error' : data ? 'success' : 'pending';

    await db.query(
      `INSERT INTO job_items (id, job_id, position, url, status, error, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [itemId, id, position, url, status, error || null, data ? JSON.stringify(data) : null],
    );

    const item = error ? { url, status: 'error', error } : data ? { url, status: 'success', data } : { url, status: 'pending' };
    Object.defineProperty(item, '__id', { value: itemId, enumerable: false });
    items.push(item);
  }

  return { id, ownerEmail, createdAt: createdAt.toISOString(), items };
}

async function saveJob(job) {
  for (const item of job.items) {
    await db.query(
      `UPDATE job_items SET status = $1, data = $2, error = $3, stage_label = $4, started_at = $5, finished_at = $6
       WHERE id = $7`,
      [
        item.status,
        item.data ? JSON.stringify(item.data) : null,
        item.error || null,
        item.stageLabel || null,
        item.startedAt || null,
        item.finishedAt || null,
        item.__id,
      ],
    );
  }
}

// Large storefronts can have tens of thousands of items — always compute
// counts via a SQL aggregate (cheap) rather than the full row set, and let
// callers optionally page the items themselves via { offset, limit }.
async function loadJob(id, { offset = 0, limit } = {}) {
  const jobRes = await db.query('SELECT id, owner_email, created_at FROM jobs WHERE id = $1', [id]);
  if (jobRes.rows.length === 0) return null;

  const countsRes = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success,
            COUNT(*) FILTER (WHERE status = 'error')::int AS error,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'running')::int AS running,
            COUNT(*) FILTER (WHERE status = 'stopped')::int AS stopped,
            COUNT(*) FILTER (WHERE status = 'success' AND (data->>'isPart')::boolean IS TRUE)::int AS parts
     FROM job_items WHERE job_id = $1`,
    [id],
  );
  const counts = countsRes.rows[0];

  let itemsSql = 'SELECT * FROM job_items WHERE job_id = $1 ORDER BY position';
  const params = [id];
  if (limit != null) {
    itemsSql += ' LIMIT $2 OFFSET $3';
    params.push(limit, offset);
  }
  const itemsRes = await db.query(itemsSql, params);

  return {
    id: jobRes.rows[0].id,
    ownerEmail: jobRes.rows[0].owner_email,
    createdAt: jobRes.rows[0].created_at.toISOString(),
    items: itemsRes.rows.map(toItem),
    counts,
  };
}

async function getJobOwner(id) {
  const { rows } = await db.query('SELECT owner_email FROM jobs WHERE id = $1', [id]);
  return rows[0]?.owner_email ?? null;
}

async function deleteItem(jobId, url) {
  await db.query('DELETE FROM job_items WHERE job_id = $1 AND url = $2', [jobId, url]);
}

// job_items has ON DELETE CASCADE on job_id, so this removes the whole job.
async function deleteJob(jobId) {
  await db.query('DELETE FROM jobs WHERE id = $1', [jobId]);
}

// A user-initiated stop must be durable — without persisting it, the still-
// 'pending' items look identical to a crash-interrupted job after a restart,
// and findIncompleteJobs() would wrongly auto-resume a job the user stopped
// on purpose. 'stopped' items are excluded from that recovery scan, and are
// picked back up only by an explicit resume.
async function markPendingAsStopped(jobId) {
  await db.query(`UPDATE job_items SET status = 'stopped' WHERE job_id = $1 AND status = 'pending'`, [jobId]);
}

// Two cases need recovery at boot: (1) an item still marked 'running' is a
// leftover from a previous crash — nothing is actively processing it anymore
// — reset it to 'pending'; (2) a job that was sitting in the in-memory run
// queue when the process restarted never got a chance to start at all, but
// its items are already 'pending' from creation, so no reset is needed there
// — it just needs to be found and re-enqueued. Both cases reduce to "does
// this job have any pending item", ordered by creation so jobs re-enter the
// queue in their original order rather than all firing in parallel.
async function findIncompleteJobs() {
  await db.query(
    `UPDATE job_items SET status = 'pending', stage_label = NULL, started_at = NULL WHERE status = 'running'`,
  );
  const { rows } = await db.query(
    `SELECT DISTINCT j.id, j.created_at FROM jobs j
     JOIN job_items ji ON ji.job_id = j.id AND ji.status = 'pending'
     ORDER BY j.created_at ASC`,
  );
  return rows.map((r) => r.id);
}

async function listJobs(ownerEmail) {
  const { rows } = await db.query(
    `SELECT j.id, j.created_at,
            COUNT(ji.id)::int AS total,
            COUNT(ji.id) FILTER (WHERE ji.status = 'success')::int AS success,
            COUNT(ji.id) FILTER (WHERE ji.status = 'error')::int AS error
     FROM jobs j
     LEFT JOIN job_items ji ON ji.job_id = j.id
     WHERE j.owner_email = $1
     GROUP BY j.id
     ORDER BY j.created_at DESC`,
    [ownerEmail],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at.toISOString(),
    total: r.total,
    success: r.success,
    error: r.error,
  }));
}

module.exports = {
  createJob, saveJob, loadJob, listJobs, deleteItem, deleteJob, findIncompleteJobs, getJobOwner, markPendingAsStopped,
};
