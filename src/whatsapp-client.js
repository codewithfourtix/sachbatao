const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { config } = require('./config');
const logger = require('./logger');

ffmpeg.setFfmpegPath(ffmpegPath);

// Chromium leaves Singleton* lock files in its profile directory. When that
// profile lives on a persistent volume and the previous container exited
// uncleanly (e.g. a redeploy), the stale lock makes the next launch fail with
// "profile appears to be in use by another Chromium process" (exit code 21),
// crash-looping the bot. No Chromium is running yet at startup, so these locks
// are always safe to remove. (Before the volume, the profile was wiped each
// restart, which is why this only started after persistence was added.)
function clearChromiumLocks(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // directory doesn't exist yet — nothing to clean
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      clearChromiumLocks(full);
    } else if (/^Singleton(Lock|Cookie|Socket)$/.test(entry.name)) {
      try {
        fs.unlinkSync(full);
        logger.warn('Removed stale Chromium lock', { file: full });
      } catch (err) {
        logger.warn('Failed to remove Chromium lock', { file: full, error: err.message });
      }
    }
  }
}

class WhatsAppClient {
  
  constructor(messageHandler) {
    this.messageHandler = messageHandler;
    this.latestQR = null;
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
      this.latestQR = qr;
      logger.info('QR code generated — visit your Railway URL to scan it');
    });

    this.client.on('authenticated', () => {
      this.latestQR = null;
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
        const isImage = message.type === 'image';
        const isDocument = message.type === 'document';

        if (!isVoiceNote && !isText && !isImage && !isDocument) {
          logger.debug('Ignoring unsupported message type', { type: message.type });
          return;
        }

        let normalizedType = 'text';
        if (isVoiceNote) normalizedType = 'voice';
        else if (isImage) normalizedType = 'image';
        else if (isDocument) normalizedType = 'document';

        await this.messageHandler({
          type: normalizedType,
          data: message,
          from: message.from,
          body: isText ? message.body : null,
        });
      } catch (err) {
        logger.error('Error in message event handler', { error: err.message });
      }
    });
  }

  async initialize() {
    logger.info('Initializing WhatsApp client', { sessionStorage: config.sessionStorage });

    // Remove any stale Chromium locks left on the persistent session volume by a
    // previous container, otherwise the browser refuses to launch (exit code 21).
    clearChromiumLocks(config.sessionStorage);

    const port = process.env.PORT || 3000;

    http.createServer(async (req, res) => {
      try {
        if (this.latestQR) {
          const img = await QRCode.toBuffer(this.latestQR);
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(img);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h2>✅ Already authenticated — bot is running!</h2><p>No QR needed.</p>');
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error generating QR: ' + err.message);
      }
    }).listen(port, () => {
      logger.info(`QR server listening on port ${port}`);
    });

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