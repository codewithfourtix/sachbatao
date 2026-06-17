// In-memory sliding-window rate limiter, keyed by WhatsApp sender.
//
// Each incoming message costs a paid OpenRouter call (vision OCR for images,
// LLM for analysis), so a spam loop from a single number could run up the bill.
// This caps how many messages one sender can trigger per time window.
//
// State lives in the process, so counters reset on restart and are NOT shared
// across replicas. That is fine for the current single-replica deployment; move
// to Redis if you ever run more than one instance.
class RateLimiter {
  constructor({ maxRequests = 5, windowMs = 60 * 1000 } = {}) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.hits = new Map(); // sender -> number[] (request timestamps, ms)
    this.notified = new Map(); // sender -> last "please wait" notify ts (ms)
  }

  // Record the request and report whether it is within the limit.
  // Returns true if allowed, false if the sender is over the limit.
  check(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const timestamps = (this.hits.get(key) || []).filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.hits.set(key, timestamps); // keep the pruned list
      return false;
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return true;
  }

  // Whole seconds until the sender's oldest hit leaves the window (i.e. how long
  // they should wait before retrying).
  retryAfter(key) {
    const timestamps = this.hits.get(key) || [];
    if (timestamps.length === 0) return 0;
    const ms = timestamps[0] + this.windowMs - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  }

  // True at most once per window per sender, so a blocked user gets exactly one
  // "please wait" reply instead of one per dropped message.
  shouldNotify(key) {
    const now = Date.now();
    const last = this.notified.get(key) || 0;
    if (now - last >= this.windowMs) {
      this.notified.set(key, now);
      return true;
    }
    return false;
  }

  // Drop senders with no recent activity so the maps don't grow unbounded.
  prune() {
    const windowStart = Date.now() - this.windowMs;

    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((t) => t > windowStart);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }

    for (const [key, ts] of this.notified) {
      if (ts <= windowStart) this.notified.delete(key);
    }
  }
}

module.exports = RateLimiter;
