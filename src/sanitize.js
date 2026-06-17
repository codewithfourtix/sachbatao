const logger = require('./logger');

// Guardrails #4 (calibrated/aid), #5 (hallucination), #8 (escalation).
// These run as POST-processing on the model's reply text. They are deliberately
// ADDITIVE / SUBTRACTIVE-of-bad-data only — they never invent a verdict, they
// just (a) strip contact details the model may have hallucinated and (b) make
// sure official channels are present where the harm of omission is high.

// The ONLY contact details the bot is allowed to surface. Anything else in the
// reply that looks like a phone number or link is assumed hallucinated and
// removed. Short codes/helplines are curated here, not scraped from the DB
// (which also contains scammer numbers we must never echo as legitimate).
const ALLOWED_SHORT_CODES = ['8171', '9915', '8070', '15', '1991', '786'];

function isAllowedDomain(host) {
  const h = host.toLowerCase().replace(/^www\./, '');
  return h === 'gov.pk' || h.endsWith('.gov.pk') || h.endsWith('.gop.pk');
}

// Matches bare or http(s) domains with a real TLD (incl. .pk for gov.pk/gop.pk).
const URL_RE =
  /\b(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|pk|info|site|online|xyz|co|app|link|pay|biz|me)\b(?:\/[^\s]*)?/gi;

const PK_MOBILE_RE = /(?:\+?92|0)[\s-]?3\d{2}[\s-]?\d{6,7}\b/g;
const LONG_NUM_RE = /\b\d{7,}\b/g; // 7+ digits = phone/UAN/account, never a legit short code

const LINK_REMOVED = '(لنک ہٹا دیا گیا)';
const NUM_REMOVED = '(نمبر ہٹا دیا گیا)';

// #5 — strip any link/number the model produced that isn't an official one.
function sanitizeFactualClaims(text) {
  if (typeof text !== 'string' || !text) return { text, removed: [] };
  const removed = [];

  let out = text.replace(URL_RE, (match) => {
    const host = match.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (isAllowedDomain(host)) return match;
    removed.push(match);
    return LINK_REMOVED;
  });

  out = out.replace(PK_MOBILE_RE, (match) => {
    removed.push(match);
    return NUM_REMOVED;
  });

  out = out.replace(LONG_NUM_RE, (match) => {
    if (ALLOWED_SHORT_CODES.includes(match)) return match; // can't happen (7+ digits) but explicit
    removed.push(match);
    return NUM_REMOVED;
  });

  return { text: out, removed };
}

// #4 — never clear a government-aid message without pointing to 8171.
const AID_RE = /(bisp|بے ?نظیر|ehsaas|احساس|8171|kafalat|کفالت)/i;

function ensureAidVerification(text, fraudType = '') {
  const hay = `${text} ${fraudType}`;
  if (!AID_RE.test(hay)) return text;
  if (/8171/.test(text)) return text;
  return (
    text +
    '\n\n_تصدیق صرف 8171 یا قریبی بی آئی ایس پی دفتر سے کریں۔ بی آئی ایس پی/احساس کبھی فیس نہیں مانگتا۔_'
  );
}

// #8 — high-emotion scams must surface a human/helpline and a "ask family first"
// nudge. The bot is never the terminal node for these.
const EMERGENCY_RE =
  /(kidnap|اغوا|بچہ|بیٹا|بیٹی|emergency|ہنگامی|حادثہ|فوری ?رقم|فوری ?پیسے|گرفتار|arrest|اکاؤنٹ ?بلاک|account ?block)/i;

function ensureEscalation(text, warningLevel, fraudType = '') {
  const hay = `${text} ${fraudType}`;
  if (warningLevel !== 'high' && !EMERGENCY_RE.test(hay)) return text;
  if (/1991/.test(text)) return text;
  return (
    text +
    '\n\n_ہنگامی مدد: پولیس 15 | ایف آئی اے سائبر کرائم 1991۔ پیسے بھیجنے سے پہلے کسی بھروسے والے گھر والے سے بات کریں۔_'
  );
}

// Run the full post-processing pipeline on a normalized verdict.
function applyOutputGuardrails(result) {
  if (!result || typeof result.response_text !== 'string') return result;

  const { text: cleaned, removed } = sanitizeFactualClaims(result.response_text);
  if (removed.length) {
    logger.warn('Stripped unverified contact details from reply', { count: removed.length });
  }

  let text = ensureAidVerification(cleaned, result.fraud_type || '');
  text = ensureEscalation(text, result.warning_level, result.fraud_type || '');

  return { ...result, response_text: text };
}

module.exports = {
  sanitizeFactualClaims,
  ensureAidVerification,
  ensureEscalation,
  applyOutputGuardrails,
};
