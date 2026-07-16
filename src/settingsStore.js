const crypto = require('crypto');
const db = require('./db');

const SENSITIVE_KEYS = new Set(['dotmed_password']);

// key -> env var used to seed the DB on first read, if no row exists yet
const ENV_SEED = {
  dotmed_email: 'DOTMED_EMAIL',
  dotmed_password: 'DOTMED_PASSWORD',
  proxy_change_ip_url: 'PROXY_CHANGE_IP_URL',
  allowed_google_emails: 'ALLOWED_GOOGLE_EMAILS',
};

function getEncryptionKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY має бути 32-байтним hex-рядком (64 символи) в .env');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decrypt(encoded) {
  const key = getEncryptionKey();
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function getSetting(key) {
  const { rows } = await db.query('SELECT value, encrypted FROM settings WHERE key = $1', [key]);
  if (rows.length > 0) {
    const { value, encrypted } = rows[0];
    return encrypted ? decrypt(value) : value;
  }

  const envVar = ENV_SEED[key];
  const seedValue = envVar ? process.env[envVar] : undefined;
  if (seedValue === undefined) return undefined;

  await setSetting(key, seedValue);
  return seedValue;
}

async function setSetting(key, value) {
  const sensitive = SENSITIVE_KEYS.has(key);
  const stored = sensitive ? encrypt(value) : value;
  await db.query(
    `INSERT INTO settings (key, value, encrypted, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, encrypted = $3, updated_at = now()`,
    [key, stored, sensitive],
  );
}

async function getAllSettings() {
  const keys = Object.keys(ENV_SEED);
  const values = await Promise.all(keys.map((key) => getSetting(key)));
  const result = {};
  keys.forEach((key, i) => {
    result[key] = SENSITIVE_KEYS.has(key) ? Boolean(values[i]) : (values[i] || '');
  });
  return result;
}

const KNOWN_KEYS = Object.keys(ENV_SEED);

module.exports = { getSetting, setSetting, getAllSettings, SENSITIVE_KEYS, KNOWN_KEYS };
