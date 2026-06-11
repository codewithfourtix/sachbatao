# WhatsApp Fraud Detection System

Urdu/English fraud detection assistant over WhatsApp. All AI runs through **OpenRouter** — one API key for LLM, speech-to-text, and text-to-speech.

## Features

- WhatsApp Web integration via `whatsapp-web.js` (QR login, session persistence)
- Voice notes: download → convert → OpenRouter Whisper → LLM → OpenRouter TTS voice reply
- Text messages: OpenRouter LLM analysis → Urdu text reply
- Fraud types: bank impersonation, OTP theft, emergency scams, link fraud, prize scams, relative impersonation
- High-risk webhook alerts (optional)
- Audit logging to `temp/logs/`
- Docker-ready with Chromium and ffmpeg

## Cost (default models)

| Step | Model | Approx. cost |
|------|-------|--------------|
| Text fraud check | `google/gemini-2.0-flash-lite-001` | ~$0.0001 / message |
| Voice transcription | `openai/whisper-1` | $0.006 / minute |
| Voice reply | `hexgrad/kokoro-82m` | ~$0.0002 / reply |

**~1000 text checks ≈ $0.10** · **~100 voice notes (30s each) ≈ $0.50**

Set `OPENROUTER_LLM_MODEL=openrouter/free` for zero-cost LLM (less reliable).

## Quick Start

```bash
cd fraud-detection-wa
cp .env.example .env
# Edit .env — set OPENROUTER_API_KEY

npm install
npm start

# Or Docker
docker-compose up --build
```

Scan the QR code printed in the terminal with WhatsApp → Linked Devices.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | **Yes** | — | Single key for all AI |
| `OPENROUTER_LLM_MODEL` | No | `google/gemini-2.0-flash-lite-001` | Fraud analysis |
| `OPENROUTER_STT_MODEL` | No | `openai/whisper-1` | Voice → text |
| `OPENROUTER_TTS_MODEL` | No | `hexgrad/kokoro-82m` | Text → voice |
| `OPENROUTER_TTS_VOICE` | No | `hf_alpha` | Hindi female (Urdu text) |
| `FRAUD_ALERT_WEBHOOK` | No | — | High-risk alert URL |
| `SESSION_STORAGE` | No | `./temp/sessions` | WhatsApp session path |

## Message Flow

```
Text  → OpenRouter LLM → Text reply
Voice → OpenRouter Whisper → OpenRouter LLM → OpenRouter TTS → Voice reply
```

## Test Cases

| Input | Message (Urdu) | Expected |
|-------|----------------|----------|
| Text | میں بینک سے بول رہا ہوں، OTP بھیجو | FRAUD |
| Voice | میرا بیٹا ہسپتال میں ہے، فوری 50,000 روپے بھیجو | FRAUD |
| Text | کل ملتے ہیں، نماز کے بعد | SAFE |
| Voice | یہ لنک کھولیں اور اپنا پن ڈالیں | FRAUD |

## Project Structure

```
src/
  index.js              # Orchestrator
  openrouter-client.js  # Single OpenRouter API client
  whatsapp-client.js    # WhatsApp Web client
  fraud-detector.js     # LLM fraud analysis
  audio-processor.js    # Voice file handling + ffmpeg
  stt-service.js        # OpenRouter STT
  tts-service.js        # OpenRouter TTS
  config.js             # Config & prompts
  logger.js             # Audit trail
```

## Docker Notes

- Session data is persisted in `./temp/sessions`
- `network_mode: host` works on **Linux**; on Windows Docker Desktop, remove it if connections fail

## Logs

```bash
docker logs -f whatsapp-fraud-detector
# Audit logs: temp/logs/audit-YYYY-MM-DD.log
```
