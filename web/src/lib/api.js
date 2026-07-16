export async function createJob(urls, types) {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, types }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body.jobId;
}

export async function getJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}`);
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
