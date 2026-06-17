const SPEECH_DECORATION_RE = /[*_`~]/g;
const SPEECH_SYMBOL_RE = /[️•]/g;

function stripSpeechFormatting(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(SPEECH_DECORATION_RE, '')
    .replace(SPEECH_SYMBOL_RE, ' ')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-–—]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\s*\/\s*/g, '۔ ')
    .replace(/\n+/g, '۔ ');
}

module.exports = {
  stripSpeechFormatting,
};
