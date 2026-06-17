const axios = require('axios');
const { validateConfig } = require('./config');
const logger = require('./logger');
const WhatsAppClient = require('./whatsapp-client');
const FraudDetector = require('./fraud-detector');
const AudioProcessor = require('./audio-processor');
const STTService = require('./stt-service');
const TTSService = require('./tts-service');
const OCRService = require('./ocr-service');
const { PDFService, MAX_PAGES } = require('./pdf-service');
const RateLimiter = require('./rate-limiter');
const { DisclosureTracker, DISCLOSURE_TEXT } = require('./disclosure');
const { FeedbackTracker, FEEDBACK_PROMPT, FEEDBACK_THANKS } = require('./feedback');
const { AbuseMonitor } = require('./abuse-monitor');
const { redactPII, hashSender, safePreview } = require('./redact');

// Per-sender cap. Each message triggers a paid OpenRouter call, so this guards
// against spam loops running up the bill. Tune via env if needed.
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 5;
const RATE_LIMIT_WINDOW_MS = (Number(process.env.RATE_LIMIT_WINDOW_SEC) || 60) * 1000;

// Appended to the reply when a PDF had more pages than we scanned.
const PDF_TRUNCATION_NOTE =
  `\n\n_نوٹ: ہم نے اس فائل کے صرف پہلے ${MAX_PAGES} صفحات چیک کیے ہیں۔ یہ نتیجہ اسی بنیاد پر ہے۔_`;

class FraudDetectionSystem {
  constructor() {
    this.fraudDetector = new FraudDetector();
    this.stt = new STTService();
    this.tts = new TTSService();
    this.ocr = new OCRService();
    this.pdf = new PDFService();
    this.audioProcessor = new AudioProcessor();
    this.whatsapp = new WhatsAppClient(this.handleMessage.bind(this));
    this.processing = new Set();
    this.rateLimiter = new RateLimiter({
      maxRequests: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    this.disclosure = new DisclosureTracker();
    this.feedback = new FeedbackTracker();
    this.abuse = new AbuseMonitor();

    // Periodically drop stale in-memory entries. unref() so it never keeps the
    // process alive on its own.
    this.pruneTimer = setInterval(() => {
      this.rateLimiter.prune();
      this.feedback.prune();
      this.abuse.prune();
    }, RATE_LIMIT_WINDOW_MS);
    this.pruneTimer.unref();
  }

  async handleMessage(message) {
    const messageKey = `${message.from}-${message.data?.id?._serialized || Date.now()}`;
    const who = hashSender(message.from);

    if (this.processing.has(messageKey)) {
      logger.warn('Skipping duplicate message', { from: who });
      return;
    }

    // Feedback capture (guardrail #12). Cheap, no API call. Only fires when this
    // sender has feedback pending and the message is exactly a yes/no token.
    if (message.body) {
      const verdictFeedback = this.feedback.classify(message.from, message.body);
      if (verdictFeedback) {
        const pending = this.feedback.consume(message.from);
        logger.audit('feedback', {
          from: who,
          value: verdictFeedback,
          fraud_type: pending?.meta?.fraud_type || null,
        });
        try {
          await this.whatsapp.sendTextMessage(message.from, FEEDBACK_THANKS);
        } catch (err) {
          logger.error('Failed to send feedback ack', { from: who, error: err.message });
        }
        return;
      }
    }

    // Per-sender rate limit. Checked before any media download or OpenRouter
    // call so a spam loop costs us nothing. A blocked sender is told to wait
    // once per window; further messages in that window are dropped silently.
    if (!this.rateLimiter.check(message.from)) {
      const waitSec = this.rateLimiter.retryAfter(message.from);
      logger.audit('rate_limited', { from: who, retry_after_sec: waitSec });

      if (this.rateLimiter.shouldNotify(message.from)) {
        try {
          await this.whatsapp.sendTextMessage(
            message.from,
            `براہ کرم تھوڑا انتظار کریں۔ آپ نے بہت تیزی سے کئی پیغامات بھیجے ہیں۔ ${waitSec} سیکنڈ بعد دوبارہ کوشش کریں۔`
          );
        } catch (err) {
          logger.error('Failed to send rate-limit reply', { from: who, error: err.message });
        }
      }
      return;
    }

    this.processing.add(messageKey);

    let tempFiles = [];

    try {
      logger.audit('message_received', { from: who, type: message.type });

      // First-contact disclosure (guardrail #6): tell the user this is an AI,
      // not a government service, advisory only, and how their data is used.
      if (this.disclosure.needsDisclosure(message.from)) {
        this.disclosure.markSeen(message.from);
        try {
          await this.whatsapp.sendTextMessage(message.from, DISCLOSURE_TEXT);
        } catch (err) {
          logger.error('Failed to send disclosure', { from: who, error: err.message });
        }
      }

      let userText;
      let responseSuffix = '';

      if (message.type === 'voice') {
        userText = await this.processVoiceMessage(message, tempFiles);
      } else if (message.type === 'image') {
        userText = await this.processImageMessage(message);
      } else if (message.type === 'document') {
        const result = await this.processDocumentMessage(message);

        // Non-PDF (or unreadable) document: reply directly, skip fraud analysis.
        if (result.reply) {
          await this.whatsapp.sendTextMessage(message.from, result.reply);
          return;
        }

        userText = result.text;
        responseSuffix = result.suffix || '';
      } else {
        userText = message.body;
        logger.info('Text message received', { from: who, preview: safePreview(userText) });
      }

      const fraudResult = await this.fraudDetector.analyze(userText, { source: message.type });
      logger.info('Fraud analysis complete', {
        from: who,
        is_fraud: fraudResult.is_fraud,
        confidence: fraudResult.confidence,
        warning_level: fraudResult.warning_level,
      });

      // Dual-use abuse signal (guardrail #7): one sender repeatedly submitting the
      // same fraud-flagged content (ignoring digits) looks like evasion testing.
      if (fraudResult.is_fraud && this.abuse.record(message.from, userText)) {
        logger.audit('abuse_probe_suspected', { from: who, fraud_type: fraudResult.fraud_type });
      }

      let responseText = fraudResult.response_text + responseSuffix;

      // Attach the feedback prompt only on real verdicts sent over text (not on
      // greetings, challan help, or voice replies).
      const attachFeedback = Boolean(fraudResult.is_verdict) && message.type !== 'voice';
      if (attachFeedback) {
        responseText += FEEDBACK_PROMPT;
      }

      if (message.type === 'voice') {
        await this.sendVoiceResponse(message.from, responseText);
      } else {
        await this.whatsapp.sendTextMessage(message.from, responseText);
      }

      if (attachFeedback) {
        this.feedback.markPending(message.from, {
          fraud_type: fraudResult.fraud_type,
          is_fraud: fraudResult.is_fraud,
        });
      }

      if (fraudResult.warning_level === 'high' && process.env.FRAUD_ALERT_WEBHOOK) {
        await this.sendAlertToDashboard(fraudResult, userText, message.from);
      }
    } catch (err) {
      logger.error('Failed to process message', { from: who, error: err.message });

      let errorReply;
      if (err.message === 'NO_TEXT_IN_IMAGE') {
        errorReply = 'تصویر میں کوئی متن نہیں ملا۔ براہ کرم صاف تصویر بھیجیں یا پیغام لکھ کر بھیجیں۔';
      } else if (message.type === 'voice') {
        errorReply = 'معذرت، آپ کے وائس نوٹ کو پروسیس نہیں کیا جا سکا۔ براہ کرم دوبارہ بھیجیں یا ٹیکسٹ میں لکھیں۔';
      } else {
        errorReply = 'معذرت، آپ کے پیغام کو پروسیس نہیں کیا جا سکا۔ براہ کرم دوبارہ کوشش کریں۔';
      }

      try {
        if (message.type === 'voice') {
          await this.sendVoiceResponse(message.from, errorReply);
        } else {
          await this.whatsapp.sendTextMessage(message.from, errorReply);
        }
      } catch (replyErr) {
        logger.error('Failed to send error reply', { from: who, error: replyErr.message });
      }
    } finally {
      await this.audioProcessor.cleanup(...tempFiles);
      this.processing.delete(messageKey);
    }
  }

  async processVoiceMessage(message, tempFiles) {
    const media = await message.data.downloadMedia();
    if (!media) {
      throw new Error('Failed to download voice note media');
    }

    const savedPath = await this.audioProcessor.saveTempAudio(media);
    tempFiles.push(savedPath);

    const mp3Path = await this.audioProcessor.convertToMp3(savedPath);
    if (mp3Path !== savedPath) {
      tempFiles.push(mp3Path);
    }

    const userText = await this.stt.transcribeUrdu(mp3Path);
    logger.info('Voice transcribed', { from: hashSender(message.from), preview: safePreview(userText) });
    return userText;
  }

  async processImageMessage(message) {
    const media = await message.data.downloadMedia();
    if (!media) {
      throw new Error('Failed to download image media');
    }

    const userText = await this.ocr.extractFromImage(media);
    logger.info('Image text extracted', { from: hashSender(message.from), preview: safePreview(userText) });

    if (!userText.trim()) {
      // Surface a clear message instead of running fraud analysis on empty text.
      throw new Error('NO_TEXT_IN_IMAGE');
    }

    return userText;
  }

  async processDocumentMessage(message) {
    const media = await message.data.downloadMedia();
    if (!media) {
      throw new Error('Failed to download document media');
    }

    const isPdf = (media.mimetype || '').toLowerCase().includes('pdf');
    if (!isPdf) {
      logger.info('Unsupported document type received', { from: hashSender(message.from), mimetype: media.mimetype });
      return {
        reply: 'معذرت، فی الحال صرف PDF فائلیں چیک کی جا سکتی ہیں۔ آپ متن، تصویر یا وائس نوٹ بھی بھیج سکتے ہیں۔',
      };
    }

    const buffer = Buffer.from(media.data, 'base64');
    const { text, totalPages, truncated } = await this.pdf.extractFirstPages(buffer);
    logger.info('PDF text extracted', {
      from: hashSender(message.from),
      totalPages,
      preview: safePreview(text),
    });

    if (!text.trim()) {
      return {
        reply: 'معذرت، اس PDF میں کوئی متن نہیں ملا۔ ممکن ہے یہ صرف تصاویر پر مشتمل ہو۔ آپ اسکرین شاٹ بھیج کر دیکھ سکتے ہیں۔',
      };
    }

    return {
      text,
      suffix: truncated ? PDF_TRUNCATION_NOTE : '',
    };
  }

  async sendVoiceResponse(to, text) {
    try {
      const audioBuffer = await this.tts.speak(text);
      await this.whatsapp.sendVoiceMessage(to, audioBuffer);
    } catch (err) {
      logger.warn('Voice reply failed, falling back to text', { error: err.message });
      await this.whatsapp.sendTextMessage(to, text);
    }
  }

  async sendAlertToDashboard(fraudResult, userText, from) {
    const webhook = process.env.FRAUD_ALERT_WEBHOOK;
    if (!webhook) return;

    try {
      await axios.post(webhook, {
        timestamp: new Date().toISOString(),
        from,
        is_fraud: fraudResult.is_fraud,
        fraud_type: fraudResult.fraud_type,
        confidence: fraudResult.confidence,
        warning_level: fraudResult.warning_level,
        // PII redacted before leaving the process (guardrail #3).
        user_message: redactPII(userText),
        response_text: fraudResult.response_text,
      }, { timeout: 10000 });

      logger.audit('high_risk_alert_sent', { from: hashSender(from), fraud_type: fraudResult.fraud_type });
    } catch (err) {
      logger.error('Failed to send fraud alert webhook', { error: err.message });
    }
  }

  async start() {
    validateConfig();
    await this.whatsapp.initialize();
    logger.info('Fraud detection system running');
  }
}

const system = new FraudDetectionSystem();

system.start().catch((err) => {
  logger.error('Fatal startup error', { error: err.message });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  process.exit(0);
});
