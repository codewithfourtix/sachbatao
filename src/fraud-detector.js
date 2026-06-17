const OpenRouterClient = require('./openrouter-client');
const { FRAUD_SYSTEM_PROMPT, FRAUD_RESPONSE_TEMPLATES, SCAM_PATTERNS } = require('./config');
const { applyOutputGuardrails } = require('./sanitize');
const logger = require('./logger');

const DEFAULT_RESULT = {
  is_fraud: false,
  fraud_type: null,
  confidence: 0,
  response_text: FRAUD_RESPONSE_TEMPLATES.low,
  warning_level: 'low',
  user_action_required: 'none',
};

const GREETING_PATTERNS = [
  /\bhi\b/i,
  /\bhello\b/i,
  /\bhey\b/i,
];

const GREETING_COMPRESSED_PATTERNS = [
  'assalamualaikum',
  'assalamoalaikum',
  'assalamualaikum',
  'اسلامعلیکم',
  'السلامعلیکم',
  'howareyou',
  'keseho',
  'kaiseho',
  'kyahaal',
  'whatsup',
];

const CHALLAN_HELP_PATTERNS = [
  /\bch(?:a|a)?llan\b/i,
  /چالان/,
  /e-?challan/i,
];

const CHALLAN_HELP_HINTS = [
  /\bkitna\b/i,
  /\bkahan\b/i,
  /\bkahaan\b/i,
  /\bcheck\b/i,
  /\bdekho\b/i,
  /\bdekhen\b/i,
  /\bwhere\b/i,
  /\bhow\b/i,
  /کہاں/,
  /کتنا/,
  /کیسے/,
];

const GREETING_RESPONSE =
  ' میں فراڈ، مشکوک لنک اور دھوکے والے پیغامات چیک کرتا ہوں۔\nاگر آپ کے پاس کوئی مشکوک میسج یا وائس نوٹ ہے تو وہ بھیج دیں۔';

const CHALLAN_HELP_RESPONSE =
  ' چالان چیک کرنے کے لیے سرکاری ویب سائٹ echallan.psca.gop.pk استعمال کریں۔\nاگر آپ کو کوئی مشکوک لنک، فیس یا OTP ملا ہے تو وہ بھیج دیں۔';

class FraudDetector {
  constructor() {
    this.client = new OpenRouterClient();
    this.systemPrompt = FRAUD_SYSTEM_PROMPT;
  }

  
  async analyze(userMessage, options = {}) {
    if (!userMessage || !userMessage.trim()) {
      return {
        ...DEFAULT_RESULT,
        response_text: 'معذرت، آپ کا پیغام خالی ہے۔ براہ کرم دوبارہ بھیجیں۔',
      };
    }

    // Text pulled out of an image or PDF is content the user explicitly sent to
    // be checked. The greeting/challan shortcuts only make sense for something a
    // user typed, so we skip them here — otherwise non-scam images fall through
    // to the "introduce yourself" greeting instead of getting a real verdict.
    const isExtracted = options.source === 'image' || options.source === 'document';

    if (!isExtracted) {
      const directResponse = this.getDirectResponse(userMessage);
      if (directResponse) {
        return directResponse;
      }
    }

    try {
      const raw = await this.client.chatCompletion([
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: this.buildUserContent(userMessage, options.source) },
      ]);

      const result = applyOutputGuardrails(this.normalizeResult(raw));
      logger.audit('fraud_analysis', {
        is_fraud: result.is_fraud,
        fraud_type: result.fraud_type,
        confidence: result.confidence,
        warning_level: result.warning_level,
      });

      return result;
    } catch (err) {
      logger.error('Fraud analysis failed', { error: err.message });
      return {
        ...DEFAULT_RESULT,
        response_text: 'معذرت، تجزیہ میں خرابی آئی۔ براہ کرم کچھ دیر بعد دوبارہ کوشش کریں۔',
      };
    }
  }

  // Build the user turn. The content to analyze is UNTRUSTED (the scammer wrote
  // it), so it is wrapped in <message_to_analyze> tags the system prompt tells
  // the model never to obey instructions from (guardrail #2). Any attempt by the
  // content to close the tag early is neutralized first. A provenance note for
  // OCR/PDF text is kept OUTSIDE the tags so it isn't mistaken for user content.
  buildUserContent(userMessage, source) {
    const safe = String(userMessage).replace(/<\/?message_to_analyze>/gi, '[tag]');

    let note = '';
    if (source === 'image') {
      note =
        '(نوٹ: یہ متن ایک تصویر سے OCR کے ذریعے نکالا گیا ہے جو صارف نے فراڈ چیک کے لیے بھیجی — ' +
        'یہ سلام یا سوال نہیں، ہمیشہ verdict دیں۔)\n';
    } else if (source === 'document') {
      note =
        '(نوٹ: یہ متن ایک PDF فائل سے نکالا گیا ہے جو صارف نے فراڈ چیک کے لیے بھیجی — ' +
        'یہ سلام یا سوال نہیں، ہمیشہ verdict دیں۔)\n';
    }

    return `${note}<message_to_analyze>\n${safe}\n</message_to_analyze>`;
  }

  getDirectResponse(userMessage) {
    const normalizedMessage = String(userMessage).trim();

    if (this.isGreeting(normalizedMessage)) {
      return {
        ...DEFAULT_RESULT,
        response_text: GREETING_RESPONSE,
        user_action_required: 'forward_message',
      };
    }

    if (this.isChallanHelpRequest(normalizedMessage)) {
      return {
        ...DEFAULT_RESULT,
        response_text: CHALLAN_HELP_RESPONSE,
        user_action_required: 'lookup_challan',
      };
    }

    return null;
  }

  isGreeting(message) {
    const compactMessage = message
      .toLowerCase()
      .replace(/[^a-z\u0600-\u06ff]+/g, '');

    return (
      GREETING_PATTERNS.some((pattern) => pattern.test(message)) ||
      GREETING_COMPRESSED_PATTERNS.some((pattern) => compactMessage.includes(pattern))
    );
  }

  isChallanHelpRequest(message) {
    const hasChallanKeyword = CHALLAN_HELP_PATTERNS.some((pattern) => pattern.test(message));
    if (!hasChallanKeyword) return false;

    return CHALLAN_HELP_HINTS.some((pattern) => pattern.test(message));
  }

  normalizeResult(raw) {
    let parsed;

    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      logger.warn('LLM returned invalid JSON, using fallback');
      return { ...DEFAULT_RESULT };
    }

    const warningLevel = ['low', 'medium', 'high'].includes(parsed.warning_level)
      ? parsed.warning_level
      : 'low';

    const confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 0));

    return {
      is_fraud: Boolean(parsed.is_fraud),
      fraud_type: parsed.fraud_type || null,
      confidence,
      response_text: parsed.response_text || FRAUD_RESPONSE_TEMPLATES[warningLevel] || FRAUD_RESPONSE_TEMPLATES.low,
      warning_level: warningLevel,
      user_action_required: parsed.user_action_required || 'none',
      // marks a real LLM verdict (vs. greeting/challan/empty shortcuts) so the
      // orchestrator knows when to attach the feedback prompt.
      is_verdict: true,
    };
  }
}

module.exports = FraudDetector;
