const crypto = require('crypto');

// Guardrail #3 — PII handling.
// Users forward messages containing CNICs, phone and account numbers. We must
// not write that raw into logs (or ship it to a webhook). These helpers strip
// the obvious PII patterns and turn a sender number into a stable pseudonym so
// logs stay useful for debugging without storing the real identifiers.

// CNIC: 13 digits, usually formatted 12345-1234567-1.
const CNIC_RE = /\b\d{5}[- ]?\d{7}[- ]?\d\b/g;
// Pakistani mobile: 03xx-xxxxxxx, +92 3xx xxxxxxx, etc.
const PK_MOBILE_RE = /(?:\+?92|0)[\s-]?3\d{2}[\s-]?\d{6,7}\b/g;
// Long digit runs (card / bank account numbers), 7+ digits.
const LONG_NUM_RE = /\b\d{7,}\b/g;

function redactPII(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(CNIC_RE, '[CNIC]')
    .replace(PK_MOBILE_RE, '[PHONE]')
    .replace(LONG_NUM_RE, '[NUM]');
}

// Stable, non-reversible pseudonym for a WhatsApp id, so we can correlate a
// user's events in logs without storing their number.
function hashSender(id) {
  if (!id) return 'unknown';
  return 'u_' + crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 10);
}

// Redacted, length-capped preview safe to log.
function safePreview(text, max = 80) {
  return redactPII(String(text || '')).slice(0, max);
}

module.exports = { redactPII, hashSender, safePreview };
