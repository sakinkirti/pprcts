const assert = require('node:assert/strict');
const test = require('node:test');

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const { encryptSecret, decryptSecret } = require('../secrets');

test('encryptSecret round-trips without storing plaintext', () => {
  const plaintext = 'example-secret-value-1234567890';
  const encrypted = encryptSecret(plaintext);
  assert.match(encrypted, /^v1\./);
  assert.equal(encrypted.includes(plaintext), false);
  assert.equal(decryptSecret(encrypted), plaintext);
});

test('encrypted values use a unique nonce', () => {
  const first = encryptSecret('same-value');
  const second = encryptSecret('same-value');
  assert.notEqual(first, second);
});

test('decryptSecret rejects malformed ciphertext', () => {
  assert.throws(() => decryptSecret('not-ciphertext'), /invalid format/);
});
