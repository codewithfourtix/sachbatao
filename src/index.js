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

    // Periodically drop stale rate-limit entries. unref() so it never keeps the
    // process alive on its own.
    this.pruneTimer = setInterval(() => this.rateLimiter.prune(), RATE_LIMIT_WINDOW_MS);
    this.pruneTimer.unref();
  }

  async handleMessage(message) {
    const messageKey = `${message.from}-${message.data?.id?._serialized || Date.now()}`;

    if (this.processing.has(messageKey)) {
      logger.warn('Skipping duplicate message', { from: message.from });
      return;
    }

    // Per-sender rate limit. Checked before any media download or OpenRouter
    // call so a spam loop costs us nothing. A blocked sender is told to wait
    // once per window; further messages in that window are dropped silently.
    if (!this.rateLimiter.check(message.from)) {
      const waitSec = this.rateLimiter.retryAfter(message.from);
      logger.audit('rate_limited', { from: message.from, retry_after_sec: waitSec });

      if (this.rateLimiter.shouldNotify(message.from)) {
        try {
          await this.whatsapp.sendTextMessage(
            message.from,
            `براہ کرم تھوڑا انتظار کریں۔ آپ نے بہت تیزی سے کئی پیغامات بھیجے ہیں۔ ${waitSec} سیکنڈ بعد دوبارہ کوشش کریں۔`
          );
        } catch (err) {
          logger.error('Failed to send rate-limit reply', { error: err.message });
        }
      }
      return;
    }

    this.processing.add(messageKey);

    let tempFiles = [];

    try {
      logger.audit('message_received', { from: message.from, type: message.type });

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
        logger.info('Text message received', { from: message.from, preview: userText?.slice(0, 80) });
      }

      const fraudResult = await this.fraudDetector.analyze(userText, { source: message.type });
      logger.info('Fraud analysis complete', {
        from: message.from,
        is_fraud: fraudResult.is_fraud,
        confidence: fraudResult.confidence,
        warning_level: fraudResult.warning_level,
      });

      const responseText = fraudResult.response_text + responseSuffix;

      if (message.type === 'voice') {
        await this.sendVoiceResponse(message.from, responseText);
      } else {
        await this.whatsapp.sendTextMessage(message.from, responseText);
      }

      if (fraudResult.warning_level === 'high' && process.env.FRAUD_ALERT_WEBHOOK) {
        await this.sendAlertToDashboard(fraudResult, userText, message.from);
      }
    } catch (err) {
      logger.error('Failed to process message', { from: message.from, error: err.message });

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
        logger.error('Failed to send error reply', { error: replyErr.message });
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
    logger.info('Voice transcribed', { from: message.from, preview: userText.slice(0, 80) });
    return userText;
  }

  async processImageMessage(message) {
    const media = await message.data.downloadMedia();
    if (!media) {
      throw new Error('Failed to download image media');
    }

    const userText = await this.ocr.extractFromImage(media);
    logger.info('Image text extracted', { from: message.from, preview: userText.slice(0, 80) });

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
      logger.info('Unsupported document type received', { from: message.from, mimetype: media.mimetype });
      return {
        reply: 'معذرت، فی الحال صرف PDF فائلیں چیک کی جا سکتی ہیں۔ آپ متن، تصویر یا وائس نوٹ بھی بھیج سکتے ہیں۔',
      };
    }

    const buffer = Buffer.from(media.data, 'base64');
    const { text, totalPages, truncated } = await this.pdf.extractFirstPages(buffer);
    logger.info('PDF text extracted', { from: message.from, totalPages, preview: text.slice(0, 80) });

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
        user_message: userText,
        response_text: fraudResult.response_text,
      }, { timeout: 10000 });

      logger.audit('high_risk_alert_sent', { from, fraud_type: fraudResult.fraud_type });
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
