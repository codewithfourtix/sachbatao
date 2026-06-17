require('dotenv').config();
const path = require('path');
const fs = require('fs');

const config = {
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterReferer: process.env.OPENROUTER_REFERER || 'https://github.com/fraud-detection-wa',
  openrouterTitle: process.env.OPENROUTER_TITLE || 'WhatsApp Fraud Detector',


  llmModel: process.env.OPENROUTER_LLM_MODEL || 'google/gemini-2.0-flash-lite-001',


  sttModel: process.env.OPENROUTER_STT_MODEL || 'openai/whisper-1',


  sessionStorage: process.env.SESSION_STORAGE || './temp/sessions',
  fraudAlertWebhook: process.env.FRAUD_ALERT_WEBHOOK || '',
  logLevel: process.env.LOG_LEVEL || 'info',
  logDir: process.env.LOG_DIR || './temp/logs',
  audioDir: path.join(process.cwd(), 'temp', 'audio'),
};


const SCAM_PATTERNS = (() => {
  try {
    const patternsPath = path.join(process.cwd(), 'scam_patterns.json');
    const patternsContent = fs.readFileSync(patternsPath, 'utf-8');
    return JSON.parse(patternsContent);
  } catch (err) {
    console.error(' Failed to load scam_patterns.json:', err.message);
    throw err;
  }
})();


const FRAUD_SYSTEM_PROMPT = (() => {
  try {
    const promptPath = path.join(process.cwd(), 'system_prompt.txt');
    let promptContent = fs.readFileSync(promptPath, 'utf-8');


    const patternsJson = JSON.stringify(SCAM_PATTERNS, null, 2);
    promptContent = promptContent.replace('{SCAM_PATTERNS_JSON}', patternsJson);

    return promptContent.trim();
  } catch (err) {
    console.error(' Failed to load system_prompt.txt:', err.message);
    throw err;
  }
})();

const FRAUD_RESPONSE_TEMPLATES = {
  high: '️ خبردار! یہ فراڈ ہو سکتا ہے۔\n- کبھی بھی OTP یا پاس ورڈ نہ دیں\n- یہ نمبر بلاک کریں\n- اپنے بینک سے رابطہ کریں\n- کوئی لنک نہ کھولیں',
  medium: ' محتاط رہیں۔ یہ مشکوک لگ رہا ہے۔\nبراہ کرم تصدیق کے لیے اپنے بینک کو کال کریں',
  low: ' یہ پیغام محفوظ لگتا ہے۔\nپھر بھی محتاط رہیں اور کوئی ذاتی معلومات شیئر نہ کریں',
};


function validateConfig() {
  if (!config.openrouterApiKey) {
    throw new Error('Missing OPENROUTER_API_KEY in .env');
  }
}

module.exports = {
  config,
  SCAM_PATTERNS,
  FRAUD_SYSTEM_PROMPT,
  FRAUD_RESPONSE_TEMPLATES,
  validateConfig,
};
