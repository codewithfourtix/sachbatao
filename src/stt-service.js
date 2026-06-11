const fs = require('fs');
const OpenRouterClient = require('./openrouter-client');
const logger = require('./logger');

class STTService {
  constructor() {
    this.client = new OpenRouterClient();
  }

  
  async transcribeUrdu(audioFilePath) {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    try {
      const text = await this.client.transcribe(audioFilePath, 'ur');
      logger.info('STT transcription complete', { length: text.length });
      return text;
    } catch (err) {
      logger.error('STT transcription failed', { error: err.message, audioFilePath });
      throw new Error(`Transcription failed: ${err.message}`);
    }
  }
}

module.exports = STTService;
