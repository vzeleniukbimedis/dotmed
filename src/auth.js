const { OAuth2Client } = require('google-auth-library');
const { getSetting } = require('./settingsStore');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function getAllowlist() {
  const raw = await getSetting('allowed_google_emails') || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
}

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

module.exports = { verifyGoogleToken, getAllowlist, requireAuth };
