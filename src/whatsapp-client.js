const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { config } = require('./config');
const logger = require('./logger');

ffmpeg.setFfmpegPath(ffmpegPath);

class WhatsAppClient {
  
  constructor(messageHandler) {
    this.messageHandler = messageHandler;
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: config.sessionStorage,
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      },
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on('qr', (qr) => {
      qrcode.generate(qr, { small: true });
      logger.info('QR code generated — scan with WhatsApp mobile app');
    });

    this.client.on('authenticated', () => {
      logger.info('WhatsApp authenticated');
    });

    this.client.on('auth_failure', (msg) => {
      logger.error('WhatsApp authentication failed', { message: msg });
    });

    this.client.on('ready', () => {
      logger.info('WhatsApp client ready');
    });

    this.client.on('disconnected', (reason) => {
      logger.warn('WhatsApp disconnected', { reason });
    });

    this.client.on('message', async (message) => {
      try {
        if (message.fromMe) return;
        if (message.isStatus) return;

        const isVoiceNote = message.type === 'ptt';
        const isText = message.type === 'chat' || message.type === 'text';

        if (!isVoiceNote && !isText) {
          logger.debug('Ignoring unsupported message type', { type: message.type });
          return;
        }

        await this.messageHandler({
          type: isVoiceNote ? 'voice' : 'text',
          data: message,
          from: message.from,
          body: isVoiceNote ? null : message.body,
        });
      } catch (err) {
        logger.error('Error in message event handler', { error: err.message });
      }
    });
  }

  async initialize() {
    logger.info('Initializing WhatsApp client', { sessionStorage: config.sessionStorage });
    await this.client.initialize();
  }

  async sendTextMessage(to, text) {
    await this.client.sendMessage(to, text);
    logger.audit('message_sent', { to, type: 'text', length: text.length });
  }

  async convertMp3ToVoiceOpus(audioBuffer) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const inputPath = path.join(config.audioDir, `tts-${id}.mp3`);
    const outputPath = path.join(config.audioDir, `tts-${id}.ogg`);

    await fs.promises.mkdir(config.audioDir, { recursive: true });
    await fs.promises.writeFile(inputPath, audioBuffer);

    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec('libopus')
          .audioChannels(1)
          .audioFrequency(48000)
          .format('ogg')
          .on('end', resolve)
          .on('error', reject)
          .save(outputPath);
      });

      return await fs.promises.readFile(outputPath);
    } finally {
      await Promise.allSettled([
        fs.promises.unlink(inputPath),
        fs.promises.unlink(outputPath),
      ]);
    }
  }

  async sendVoiceMessage(to, audioBuffer) {
    try {
      const voiceBuffer = await this.convertMp3ToVoiceOpus(audioBuffer);
      const media = new MessageMedia(
        'audio/ogg; codecs=opus',
        voiceBuffer.toString('base64'),
        'response.ogg'
      );
      await this.client.sendMessage(to, media, { sendAudioAsVoice: true });
      logger.audit('message_sent', { to, type: 'voice', bytes: voiceBuffer.length });
    } catch (err) {
      logger.warn('Voice conversion failed, sending plain audio', { error: err.message });
      const media = new MessageMedia('audio/mpeg', audioBuffer.toString('base64'), 'response.mp3');
      await this.client.sendMessage(to, media);
      logger.audit('message_sent', { to, type: 'audio', bytes: audioBuffer.length });
    }
  }
}

module.exports = WhatsAppClient;
