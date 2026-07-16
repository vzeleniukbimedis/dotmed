export async function fetchMe() {
  const res = await fetch('/api/auth/me');
  const body = await res.json();
  return body.user;
}

export async function loginWithGoogle(credential) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Login failed');
  return body.user;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
}
