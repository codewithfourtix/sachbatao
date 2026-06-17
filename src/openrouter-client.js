const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const logger = require('./logger');

const BASE_URL = 'https://openrouter.ai/api/v1';

function formatAxiosError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const providerMessage =
    data?.error?.message ||
    data?.message ||
    (typeof data === 'string' ? data : null);

  if (status && providerMessage) {
    return `HTTP ${status}: ${providerMessage}`;
  }

  if (status) {
    return `HTTP ${status}: ${err.message}`;
  }

  return err.message;
}

class OpenRouterClient {
  constructor() {
    this.headers = {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.openrouterReferer,
      'X-OpenRouter-Title': config.openrouterTitle,
    };
  }

  
  async chatCompletion(messages, options = {}) {
    let response;
    try {
      response = await axios.post(
        `${BASE_URL}/chat/completions`,
        {
          model: options.model || config.llmModel,
          messages,
          temperature: options.temperature ?? 0.3,
          response_format: options.responseFormat || { type: 'json_object' },
        },
        { headers: this.headers, timeout: 60000 }
      );
    } catch (err) {
      throw new Error(`OpenRouter chat failed (${formatAxiosError(err)})`);
    }

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenRouter returned empty chat response');
    }

    logger.debug('OpenRouter chat complete', {
      model: options.model || config.llmModel,
      usage: response.data?.usage,
    });

    return content;
  }


  // OCR: extract the raw visible text from an image using a vision model.
  async extractTextFromImage(base64Data, mimetype = 'image/jpeg') {
    const dataUrl = `data:${mimetype};base64,${base64Data}`;

    let response;
    try {
      response = await axios.post(
        `${BASE_URL}/chat/completions`,
        {
          model: config.visionModel,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    'Extract ALL text visible in this image exactly as written. ' +
                    'Output only the raw text — no commentary, no translation, no labels. ' +
                    'If the image contains no readable text, output nothing.',
                },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0,
        },
        { headers: this.headers, timeout: 60000 }
      );
    } catch (err) {
      throw new Error(`OpenRouter vision OCR failed (${formatAxiosError(err)})`);
    }

    const text = String(response.data?.choices?.[0]?.message?.content || '').trim();

    logger.debug('OpenRouter OCR complete', {
      model: config.visionModel,
      chars: text.length,
      usage: response.data?.usage,
    });

    return text;
  }


  async transcribe(audioFilePath, language = 'ur') {
    const format = this.getAudioFormat(audioFilePath);
    const buffer = await fs.promises.readFile(audioFilePath);
    const base64 = buffer.toString('base64');

    let response;
    try {
      response = await axios.post(
        `${BASE_URL}/audio/transcriptions`,
        {
          model: config.sttModel,
          input_audio: { data: base64, format },
          language,
          temperature: 0,
        },
        { headers: this.headers, timeout: 120000 }
      );
    } catch (err) {
      throw new Error(`OpenRouter STT failed (${formatAxiosError(err)})`);
    }

    const text = String(response.data?.text || '').trim();
    if (!text) {
      throw new Error('OpenRouter STT returned empty transcription');
    }

    logger.debug('OpenRouter STT complete', {
      model: config.sttModel,
      format,
      usage: response.data?.usage,
    });

    return text;
  }

  
  async synthesizeSpeech(text) {
    let response;
    try {
      response = await axios.post(
        `${BASE_URL}/audio/speech`,
        {
          model: config.ttsModel,
          input: text,
          voice: config.ttsVoice,
          response_format: config.ttsFormat,
        },
        {
          headers: this.headers,
          timeout: 120000,
          responseType: 'arraybuffer',
        }
      );
    } catch (err) {
      throw new Error(`OpenRouter TTS failed (${formatAxiosError(err)})`);
    }

    const buffer = Buffer.from(response.data);
    if (!buffer.length) {
      throw new Error('OpenRouter TTS returned empty audio');
    }

    logger.debug('OpenRouter TTS complete', {
      model: config.ttsModel,
      voice: config.ttsVoice,
      bytes: buffer.length,
    });

    return buffer;
  }

  getAudioFormat(filePath) {
    const ext = path.extname(filePath).replace('.', '').toLowerCase();
    const supported = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac'];
    return supported.includes(ext) ? ext : 'mp3';
  }
}

module.exports = OpenRouterClient;
