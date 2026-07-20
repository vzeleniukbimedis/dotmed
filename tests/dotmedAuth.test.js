const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isCloudflareBlock } = require('../src/dotmedAuth');

test('isCloudflareBlock recognizes the "Attention Required!" hard block page', () => {
  assert.equal(isCloudflareBlock('<html><body>Attention Required! | Cloudflare</body></html>', 403), true);
});

test('isCloudflareBlock recognizes the Turnstile challenge widget', () => {
  assert.equal(isCloudflareBlock('<div class="cf-turnstile"></div>', 403), true);
});

test('isCloudflareBlock recognizes the "Just a moment..." JS/managed challenge page (seen live in production)', () => {
  const html = '<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>';
  assert.equal(isCloudflareBlock(html, 403), true);
});

test('isCloudflareBlock recognizes a challenge-platform script reference', () => {
  assert.equal(isCloudflareBlock('<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1"></script>', 403), true);
});

test('isCloudflareBlock is false for a genuine login failure (wrong credentials, no challenge markers)', () => {
  assert.equal(isCloudflareBlock('<html><body><form><input name="pass"></form>Invalid username or password</body></html>', 403), false);
});

test('isCloudflareBlock is false when the status is not 403, even with challenge markers present', () => {
  assert.equal(isCloudflareBlock('<title>Just a moment...</title>', 200), false);
});
