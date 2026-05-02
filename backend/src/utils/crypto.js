const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.AUTOMATION_ENCRYPTION_KEY;

function getKey() {
  if (!ENCRYPTION_KEY) {
    // Fallback: derive from JWT_SECRET for development
    const secret = process.env.JWT_SECRET || 'fallback-secret-32-chars-long!!';
    return crypto.scryptSync(secret, 'salt', 32);
  }
  return Buffer.from(ENCRYPTION_KEY, 'hex');
}

function encrypt(text) {
  if (!text) return text;
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;
  if (!encryptedText.includes(':')) return encryptedText; // plaintext fallback
  const key = getKey();
  const [ivHex, tagHex, dataHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
