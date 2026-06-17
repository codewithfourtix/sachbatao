const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { config } = require('./config');
const logger = require('./logger');

// Durable feedback storage (Gap #11/#12).
//
// logger.audit() only writes to the daily log file, which on Railway lives on the
// EPHEMERAL filesystem and is wiped on every redeploy — so feedback labels would
// not survive. This module writes each feedback record as one JSON line to a file
// that lives on the PERSISTENT session volume (default: <sessionStorage>/feedback.jsonl),
// so the labels actually accumulate. If FEEDBACK_WEBHOOK is set, the record is also
// POSTed there (e.g. to a sheet / database / dashboard) for live review.
//
// The path is resolved at call time so it can be overridden (e.g. in tests).
function feedbackLogPath() {
  return process.env.FEEDBACK_LOG_PATH || path.join(config.sessionStorage, 'feedback.jsonl');
}

async function recordFeedback(entry) {
  const record = { timestamp: new Date().toISOString(), ...entry };
  const line = JSON.stringify(record);

  // 1) Durable append to JSONL on the persistent volume.
  try {
    const file = feedbackLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line + '\n', 'utf8');
  } catch (err) {
    logger.error('Failed to persist feedback', { error: err.message });
  }

  // 2) Optional: forward to a webhook for live review / dashboards.
  const webhook = process.env.FEEDBACK_WEBHOOK;
  if (webhook) {
    try {
      await axios.post(webhook, record, { timeout: 10000 });
    } catch (err) {
      logger.warn('Feedback webhook failed', { error: err.message });
    }
  }
}

module.exports = { recordFeedback, feedbackLogPath };
