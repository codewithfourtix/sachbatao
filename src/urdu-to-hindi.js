const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

const DIGRAPHS = [
  [/الله/g, 'अल्लाह'],
  [/ال/g, 'अल'],
  [/ch/g, 'च'],
];

const LETTER_MAP = new Map([
  ['ا', 'अ'],
  ['آ', 'आ'],
  ['ب', 'ब'],
  ['پ', 'प'],
  ['ت', 'त'],
  ['ٹ', 'ट'],
  ['ث', 'स'],
  ['ج', 'ज'],
  ['چ', 'च'],
  ['ح', 'ह'],
  ['خ', 'ख'],
  ['د', 'द'],
  ['ڈ', 'ड'],
  ['ذ', 'ज़'],
  ['ر', 'र'],
  ['ڑ', 'ड़'],
  ['ز', 'ज़'],
  ['ژ', 'झ'],
  ['س', 'स'],
  ['ش', 'श'],
  ['ص', 'स'],
  ['ض', 'ज़'],
  ['ط', 'त'],
  ['ظ', 'ज़'],
  ['ع', 'अ'],
  ['غ', 'ग़'],
  ['ف', 'फ'],
  ['ق', 'क़'],
  ['ک', 'क'],
  ['گ', 'ग'],
  ['ل', 'ल'],
  ['م', 'म'],
  ['ن', 'न'],
  ['ں', 'n'],
  ['و', 'व'],
  ['ہ', 'ह'],
  ['ھ', 'ह'],
  ['ء', ''],
  ['ئ', 'य'],
  ['ؤ', 'व'],
  ['ی', 'य'],
  ['ے', 'े'],
  ['ە', 'े'],
  ['ۓ', 'े'],
  [' ', ' '],
  ['\n', '\n'],
  ['\t', ' '],
  ['۔', '।'],
  ['،', ','],
  ['؟', '?'],
  ['!', '!'],
  ['.', '.'],
  ['-', '-'],
]);

const SPEECH_DECORATION_RE = /[*_`~]/g;
const SPEECH_SYMBOL_RE = /[️•]/g;

function isArabicScript(text) {
  return /[\u0600-\u06FF]/.test(text);
}

function normalizeSpaces(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,۔!?])/g, '$1')
    .trim();
}

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

function transliterateUrduToHindi(text) {
  if (!text || !text.trim()) return text;
  if (!isArabicScript(text)) return text;

  let result = String(text)
    .replace(ARABIC_DIACRITICS, '')
    .replace(/\r\n/g, '\n');

  for (const [pattern, replacement] of DIGRAPHS) {
    result = result.replace(pattern, replacement);
  }

  result = Array.from(result)
    .map((character) => LETTER_MAP.get(character) ?? character)
    .join('');

  return normalizeSpaces(result);
}

function prepareSpeechText(text) {
  if (!text || !text.trim()) return text;

  const stripped = stripSpeechFormatting(text);
  const transliterated = transliterateUrduToHindi(stripped);

  return normalizeSpaces(transliterated);
}

module.exports = {
  transliterateUrduToHindi,
  prepareSpeechText,
  stripSpeechFormatting,
};
