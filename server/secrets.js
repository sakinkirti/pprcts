const crypto = require('crypto');

function getEncryptionKey() {
  const encoded = process.env.APP_ENCRYPTION_KEY;
  if (!encoded) {
    const error = new Error('APP_ENCRYPTION_KEY is not configured');
    error.code = 'SERVER_CONFIGURATION_ERROR';
    throw error;
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    const error = new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes');
    error.code = 'SERVER_CONFIGURATION_ERROR';
    throw error;
  }
  return key;
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptSecret(payload) {
  const [version, ivPart, tagPart, ciphertextPart] = String(payload || '').split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Encrypted secret has an invalid format');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret, getEncryptionKey };
