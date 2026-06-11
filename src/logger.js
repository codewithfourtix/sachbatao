const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[config.logLevel] ?? LEVELS.info;

function ensureLogDir() {
  if (!fs.existsSync(config.logDir)) {
    fs.mkdirSync(config.logDir, { recursive: true });
  }
}

function getLogFilePath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(config.logDir, `audit-${date}.log`);
}

function formatEntry(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
}

function writeToFile(entry) {
  try {
    ensureLogDir();
    fs.appendFileSync(getLogFilePath(), entry + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

function log(level, message, meta = {}) {
  if (LEVELS[level] > currentLevel) return;

  const entry = formatEntry(level, message, meta);
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(`[${level.toUpperCase()}] ${message}`, Object.keys(meta).length ? meta : '');

  writeToFile(entry);
}

const logger = {
  error: (message, meta) => log('error', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  info: (message, meta) => log('info', message, meta),
  debug: (message, meta) => log('debug', message, meta),

  audit(event, data = {}) {
    log('info', `AUDIT: ${event}`, { event, ...data });
  },
};

module.exports = logger;
