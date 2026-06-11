const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { config } = require('./config');
const logger = require('./logger');

ffmpeg.setFfmpegPath(ffmpegPath);

const unlink = promisify(fs.unlink);

class AudioProcessor {
  constructor() {
    this.ensureAudioDir();
  }

  ensureAudioDir() {
    if (!fs.existsSync(config.audioDir)) {
      fs.mkdirSync(config.audioDir, { recursive: true });
    }
  }

  
  async saveTempAudio(media) {
    const ext = this.getExtension(media.mimetype);
    const filename = `voice-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = path.join(config.audioDir, filename);

    const buffer = Buffer.from(media.data, 'base64');
    await fs.promises.writeFile(filePath, buffer);

    logger.debug('Saved temp audio', { filePath, mimetype: media.mimetype });
    return filePath;
  }

  getExtension(mimetype) {
    const map = {
      'audio/ogg': 'ogg',
      'audio/ogg; codecs=opus': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/webm': 'webm',
    };
    return map[mimetype] || 'ogg';
  }

  
  async convertToMp3(inputPath) {
    const outputPath = inputPath.replace(/\.[^.]+$/, '.mp3');

    if (inputPath.endsWith('.mp3')) {
      return inputPath;
    }

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libmp3lame')
        .audioChannels(1)
        .audioFrequency(16000)
        .format('mp3')
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    logger.debug('Converted audio to MP3', { inputPath, outputPath });
    return outputPath;
  }

  
  async cleanup(...filePaths) {
    for (const filePath of filePaths) {
      if (!filePath) continue;
      try {
        if (fs.existsSync(filePath)) {
          await unlink(filePath);
        }
      } catch (err) {
        logger.warn('Failed to cleanup audio file', { filePath, error: err.message });
      }
    }
  }
}

module.exports = AudioProcessor;
