// Guardrail #6 — disclosure & consent.
// On a sender's FIRST interaction we send a one-time Urdu disclosure: this is an
// AI (not a human), not a government service, advisory only, and a one-line note
// on data use. State is in-memory, so it resets on restart (a user may see the
// disclosure again after a redeploy — acceptable; erring toward MORE disclosure).

const DISCLOSURE_TEXT =
  'ℹ️ *سچ بتاؤ کے بارے میں*\n' +
  'یہ ایک AI اسسٹنٹ ہے (انسان نہیں)۔ یہ کوئی سرکاری ادارہ، حکومت یا ایف آئی اے کا حصہ نہیں۔\n' +
  'یہ صرف مشورہ دیتا ہے — کسی بھی فیصلے سے پہلے خود تصدیق کریں۔\n' +
  'آپ کا بھیجا گیا پیغام صرف فوری تجزیہ کے لیے استعمال ہوتا ہے اور محفوظ نہیں کیا جاتا۔';

class DisclosureTracker {
  constructor() {
    this.seen = new Set();
  }

  needsDisclosure(sender) {
    return !this.seen.has(sender);
  }

  markSeen(sender) {
    this.seen.add(sender);
  }
}

module.exports = { DisclosureTracker, DISCLOSURE_TEXT };
