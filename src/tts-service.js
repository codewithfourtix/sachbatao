const axios = require('axios');
const { stripSpeechFormatting } = require('./urdu-to-hindi');
const logger = require('./logger');

class TTSService {
  async speak(text) {
    if (!text || !text.trim()) {
      throw new Error('TTS requires non-empty text');
    }

    const cleanText = stripSpeechFormatting(text);

    try {
      const chunks = this.splitText(cleanText, 150);
      const buffers = [];

      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ur&client=tw-ob&q=${encodeURIComponent(chunk)}`;
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        buffers.push(Buffer.from(response.data));
      }

      logger.info('Google TTS synthesis complete', { chunks: chunks.length });
      return Buffer.concat(buffers);
    } catch (err) {
      logger.error('Google TTS synthesis failed', { error: err.message });
      throw new Error(`Google TTS failed: ${err.message}`);
    }
  }

  splitText(text, maxLength = 150) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let currentChunk = '';
    const sentences = text.split(/([۔؟!،,\n\r])/g);

    for (let i = 0; i < sentences.length; i++) {
      const part = sentences[i];
      if (!part) continue;

      if (currentChunk.length + part.length > maxLength) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = part;
      } else {
        currentChunk += part;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    const finalChunks = [];
    for (const chunk of chunks) {
      if (chunk.length <= maxLength) {
        finalChunks.push(chunk);
      } else {
        const words = chunk.split(/\s+/);
        let subChunk = '';
        for (const word of words) {
          if (subChunk.length + word.length + 1 > maxLength) {
            if (subChunk.trim()) {
              finalChunks.push(subChunk.trim());
            }
            subChunk = word;
          } else {
            subChunk += (subChunk ? ' ' : '') + word;
          }
        }
        if (subChunk.trim()) {
          finalChunks.push(subChunk.trim());
        }
      }
    }

    return finalChunks;
  }
}

module.exports = TTSService;
