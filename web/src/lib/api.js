// Returns an array — each storefront link becomes its own job, and all
// direct listing links submitted together share one job.
export async function createJob(urls, types) {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, types }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body.jobIds;
}

export async function getJob(jobId, { offset, limit } = {}) {
  const qs = new URLSearchParams();
  if (offset != null) qs.set('offset', offset);
  if (limit != null) qs.set('limit', limit);
  const suffix = qs.toString() ? `?${qs}` : '';
  const res = await fetch(`/api/jobs/${jobId}${suffix}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export async function pauseJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/pause`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export async function unpauseJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/unpause`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export async function stopJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/stop`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export async function resumeJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export async function deleteJobItem(jobId, url) {
  const res = await fetch(`/api/jobs/${jobId}/items`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export async function listJobs() {
  const res = await fetch('/api/jobs');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body.jobs;
}

export async function getSettings() {
  const res = await fetch('/api/settings');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export async function updateSettings(updates) {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export async function getAiLimits() {
  const res = await fetch('/api/ai-limits');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}
