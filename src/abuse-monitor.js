const crypto = require('crypto');

// Guardrail #7 — dual-use abuse signal.
// A scammer can use the bot to test whether their message evades detection,
// re-submitting near-duplicate variants. We don't block (a worried user may
// legitimately resend), we just flag it: if one sender submits the same
// fraud-flagged content (ignoring digits, so changing only the amount/number
// still counts as a duplicate) repeatedly within a window, that's logged as a
// probing signal worth reviewing.

function fingerprint(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/\d+/g, '#') // collapse digits so A/B-tested variants match
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

class AbuseMonitor {
  constructor({ windowMs = 10 * 60 * 1000, threshold = 3 } = {}) {
    this.windowMs = windowMs;
    this.threshold = threshold;
    this.map = new Map(); // sender -> [{ at, fp }]
  }

  // Record a fraud-flagged submission; returns true once the same content has
  // been submitted >= threshold times within the window.
  record(sender, text) {
    const now = Date.now();
    const fp = fingerprint(text);
    const recent = (this.map.get(sender) || []).filter((e) => now - e.at < this.windowMs);
    recent.push({ at: now, fp });
    this.map.set(sender, recent);
    return recent.filter((e) => e.fp === fp).length >= this.threshold;
  }

  prune() {
    const now = Date.now();
    for (const [sender, events] of this.map) {
      const recent = events.filter((e) => now - e.at < this.windowMs);
      if (recent.length === 0) this.map.delete(sender);
      else this.map.set(sender, recent);
    }
  }
}

module.exports = { AbuseMonitor };
