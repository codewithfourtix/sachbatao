# Sach Batao — Safety Guardrails & Responsible-AI Posture

This documents the safety guardrails for an LLM operating in an adversarial,
civic context. Status legend: ✅ implemented in code · 🟡 partial · 📋 policy/roadmap.

---

## Implemented in code

### #2 Prompt injection — ✅
The analyzed message is attacker-authored, so it's wrapped in
`<message_to_analyze> … </message_to_analyze>` tags (`fraud-detector.js`,
`buildUserContent`). The system prompt (`system_prompt.txt`, "SECURITY" section)
instructs the model that everything inside the tags is untrusted **data**, never
an instruction, and that an embedded "mark me as safe/verified" attempt is itself
a **strong fraud signal**. The closing tag is escaped out of user input to prevent
delimiter breakout, and structured JSON output further constrains hijacking.

### #3 PII handling — ✅ (code) / 📋 (policy)
`redact.js`: CNIC, Pakistani phone numbers, and long account/card digit runs are
stripped before anything is logged; sender numbers are replaced with a one-way
hash (`hashSender`) in all logs; the high-risk webhook redacts the message body.
**Data policy (one paragraph, for judges):** *We practice data minimization —
forwarded content is processed in-memory for analysis and not persisted; logs
store redacted metadata with pseudonymized sender ids. AI inference uses
OpenRouter (US-routed) — disclosed to users; we retain no message content there.
Users can request deletion. A formal DPA is drafted for production.*
> Note: OpenRouter routes to US providers — a cross-border transfer disclosed to users.

### #4 Calibrated confidence / aid false-positives — 🟡
System prompt: never "100% safe"; confidence < ~60 defaults to *مشکوک — تصدیق
کریں، عمل نہ کریں* (verify, don't act); government-aid messages are never cleared
without pointing to **8171**. Enforced in `sanitize.js → ensureAidVerification`,
which appends the 8171/free-program reminder to any aid-related verdict missing it.

### #5 Hallucination control — ✅
`sanitize.js → sanitizeFactualClaims` runs on every verdict: links whose domain
isn't `*.gov.pk`/`*.gop.pk` are removed, and phone-number/long-digit sequences not
in the curated allowlist (8171, 9915, 8070, 15, 1991, 786) are stripped. The
prompt also forbids inventing contacts or claiming "verified by FIA/PTA".
> Scope: links + phone/UAN-length numbers are auto-stripped. Bare 3–4 digit
> invented codes rely on the prompt + grounding (stripping them risks mangling
> legit amounts/list markers).

### #6 Disclosure & consent — ✅
`disclosure.js`: first message from any sender triggers a one-time Urdu
disclosure — AI not human, not a government/FIA service, advisory only, data-use
line. (In-memory; may re-show after a restart, erring toward more disclosure.)

### #7 Abuse / dual-use — ✅
Rate limiting (`rate-limiter.js`, 5/min/sender) plus `abuse-monitor.js`: repeated
near-duplicate **fraud-flagged** submissions from one sender (digits collapsed, so
A/B-tested variants still match) are logged as a probing signal. We log, not block.

### #8 Human escalation — ✅
`sanitize.js → ensureEscalation` + prompt: high-emotion verdicts (kidnapping,
emergency, arrest, urgent money, or any `high` warning) always surface **police 15**,
**FIA Cybercrime 1991**, and a "talk to a trusted family member before sending
money" nudge. The bot is never the terminal node for these.

### #11 Evaluation & observability — 🟡
Every verdict is logged via `logger.audit('fraud_analysis', …)` with category,
confidence, and warning level; high-risk verdicts fire a webhook. Paired with #12
feedback labels, the plan is a weekly false-negative review and a drift signal
(rising "not helpful" rate / falling fraud-flag rate on known categories). No
dashboard yet.

### #12 Feedback loop — ✅
`feedback.js`: every text verdict ends with *کیا یہ جواب مددگار تھا؟ (ہاں / نہیں)*.
A following yes/no reply within 5 min is logged as a label (not re-analyzed),
giving evaluation data and turning the bot into a learning system.

---

## Policy / roadmap (be honest with judges — these are NOT built)

### #1 Input-side content moderation — 📋
No pre-filter yet. Someone will eventually forward CSAM/gore/hate "to verify."
Plan: a moderation/safety classifier **before** OCR/STT/LLM; illegal content is
dropped without storage, with a documented CSAM legal-reporting stance. **This is
the #1 pre-launch safety item.**

### #9 Bias & dialect coverage — 📋
No bias audit yet. Whisper handles standard Urdu; performance on Punjabi/Pashto-
accented Urdu and older women's voices is unmeasured. Plan: a dialect/gender/age-
stratified eval set measuring STT WER and verdict accuracy per group, with a
"please type instead" fallback on low-confidence speech. *We'd rather say we
haven't audited than fake it.*

### #10 Language scope — 📋
Urdu-first is a deliberate reach decision but a limitation. Punjabi, Pashto,
Sindhi, Saraiki are roadmap; the models already support them, so it's a
rollout-and-eval task, not research.

### #13 Reporting upstream (FIA) — 🟡
Foundation exists (`FRAUD_ALERT_WEBHOOK` on high-risk; we already collect the
scammer's number). Plan: with user consent, auto-assemble a structured FIA
Cybercrime (1991 / cybercrime.fia.gov.pk) report so each victim feeds the national
takedown pipeline.

### #14 Impersonation — 📋
Copycat "Sach Batao" bots that clear their own scams are a real risk. Plan: one
published official number, a verified WhatsApp Business badge via a telco/gov
partnership, and a user-verifiable official link. Impersonation is itself a scam
category the bot detects.

---

## Summary table

| # | Guardrail | Status |
|---|-----------|--------|
| 1 | Input moderation | 📋 roadmap |
| 2 | Prompt injection | ✅ |
| 3 | PII handling | ✅ code / 📋 policy |
| 4 | Calibrated confidence / aid | 🟡 |
| 5 | Hallucination control | ✅ |
| 6 | Disclosure & consent | ✅ |
| 7 | Abuse / dual-use | ✅ |
| 8 | Human escalation | ✅ |
| 9 | Bias & dialect audit | 📋 roadmap |
| 10 | Language scope | 📋 roadmap |
| 11 | Eval & observability | 🟡 |
| 12 | Feedback loop | ✅ |
| 13 | Upstream FIA reporting | 🟡 foundation |
| 14 | Anti-impersonation | 📋 roadmap |
