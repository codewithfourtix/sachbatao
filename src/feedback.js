// Gap #12 — feedback loop.
// After a verdict we append a one-tap "was this helpful? (ہاں / نہیں)" prompt and
// remember that this sender has feedback pending. Their next message, IF it is
// exactly a yes/no token within the window, is logged as a label instead of being
// re-analyzed. This turns the stateless classifier into a labelled, reviewable
// system and is the source of evaluation data (Gap #11).

const FEEDBACK_PROMPT = '\n\n— کیا یہ جواب مددگار تھا؟ (ہاں / نہیں)';
const FEEDBACK_THANKS = 'شکریہ! آپ کی رائے درج کر لی گئی۔';

const YES_TOKENS = new Set(['ہاں', 'ہاںجی', 'جی', 'جیہاں', 'han', 'haan', 'ji', 'yes', 'y', 'ok']);
const NO_TOKENS = new Set(['نہیں', 'نہی', 'nahi', 'nahin', 'nae', 'no', 'n']);

function tokenize(body) {
  // keep only letters (Latin + Arabic/Urdu block); strips spaces, punctuation, emoji
  return String(body || '')
    .toLowerCase()
    .replace(/[^a-z؀-ۿ]/g, '');
}

class FeedbackTracker {
  constructor({ windowMs = 5 * 60 * 1000 } = {}) {
    this.windowMs = windowMs;
    this.pending = new Map(); // sender -> { at, meta }
  }

  markPending(sender, meta = {}) {
    this.pending.set(sender, { at: Date.now(), meta });
  }

  // Returns 'yes' | 'no' | null. Only matches when feedback is genuinely pending,
  // is still within the window, and the message is *just* a yes/no token (so a
  // real forwarded message that happens to start with "no" isn't swallowed).
  classify(sender, body) {
    const p = this.pending.get(sender);
    if (!p) return null;
    if (Date.now() - p.at > this.windowMs) {
      this.pending.delete(sender);
      return null;
    }
    const t = tokenize(body);
    if (!t) return null;
    if (YES_TOKENS.has(t)) return 'yes';
    if (NO_TOKENS.has(t)) return 'no';
    return null;
  }

  consume(sender) {
    const p = this.pending.get(sender);
    this.pending.delete(sender);
    return p;
  }

  prune() {
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (now - v.at > this.windowMs) this.pending.delete(k);
    }
  }
}

module.exports = { FeedbackTracker, FEEDBACK_PROMPT, FEEDBACK_THANKS };
