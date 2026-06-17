const OpenRouterClient = require('./openrouter-client');
const logger = require('./logger');

class OCRService {
  constructor() {
    this.client = new OpenRouterClient();
  }

  // Extract text from a WhatsApp image media object ({ data: base64, mimetype }).
  async extractFromImage(media) {
    if (!media || !media.data) {
      throw new Error('No image data to process');
    }

    const text = await this.client.extractTextFromImage(media.data, media.mimetype);
    logger.info('Image OCR complete', { chars: text.length });
    return text;
  }
}

module.exports = OCRService;
