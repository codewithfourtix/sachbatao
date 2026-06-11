const axios = require('axios');
const { validateConfig } = require('./config');
const logger = require('./logger');
const WhatsAppClient = require('./whatsapp-client');
const FraudDetector = require('./fraud-detector');
const AudioProcessor = require('./audio-processor');
const STTService = require('./stt-service');
const TTSService = require('./tts-service');

class FraudDetectionSystem {
  constructor() {
    this.fraudDetector = new FraudDetector();
    this.stt = new STTService();
    this.tts = new TTSService();
    this.audioProcessor = new AudioProcessor();
    this.whatsapp = new WhatsAppClient(this.handleMessage.bind(this));
    this.processing = new Set();
  }

  async handleMessage(message) {
    const messageKey = `${message.from}-${message.data?.id?._serialized || Date.now()}`;

    if (this.processing.has(messageKey)) {
      logger.warn('Skipping duplicate message', { from: message.from });
      return;
    }

    this.processing.add(messageKey);

    let tempFiles = [];

    try {
      logger.audit('message_received', { from: message.from, type: message.type });

      let userText;

      if (message.type === 'voice') {
        userText = await this.processVoiceMessage(message, tempFiles);
      } else {
        userText = message.body;
        logger.info('Text message received', { from: message.from, preview: userText?.slice(0, 80) });
      }

      const fraudResult = await this.fraudDetector.analyze(userText);
      logger.info('Fraud analysis complete', {
        from: message.from,
        is_fraud: fraudResult.is_fraud,
        confidence: fraudResult.confidence,
        warning_level: fraudResult.warning_level,
      });

      if (message.type === 'voice') {
        await this.sendVoiceResponse(message.from, fraudResult.response_text);
      } else {
        await this.whatsapp.sendTextMessage(message.from, fraudResult.response_text);
      }

      if (fraudResult.warning_level === 'high' && process.env.FRAUD_ALERT_WEBHOOK) {
        await this.sendAlertToDashboard(fraudResult, userText, message.from);
      }
    } catch (err) {
      logger.error('Failed to process message', { from: message.from, error: err.message });

      const errorReply = message.type === 'voice'
        ? 'معذرت، آپ کے وائس نوٹ کو پروسیس نہیں کیا جا سکا۔ براہ کرم دوبارہ بھیجیں یا ٹیکسٹ میں لکھیں۔'
        : 'معذرت، آپ کے پیغام کو پروسیس نہیں کیا جا سکا۔ براہ کرم دوبارہ کوشش کریں۔';

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
