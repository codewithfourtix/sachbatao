<div align="center">

<!-- LOGO -->
<img src="./assets/sachbatao.png" alt="sayNoToFraud logo" width="120" />

<h1>Sach Batao</h1>

<p>
  <strong>A lightweight, production-ready WhatsApp bot in Node.js for Urdu fraud detection.</strong><br/>
  Protects users by intercepting WhatsApp text messages and voice notes, analyzing them for scams, and replying with clear warnings.
</p>

<!-- BADGES -->

![NodeJS](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![OpenRouter](https://img.shields.io/badge/OpenRouter-API-bf5b0a?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)
![Status](https://img.shields.io/badge/Status-Active-00d9ff?style=flat-square)

</div>

---

## What is this?

**SachBatao** is a WhatsApp security assistant designed to protect citizens from common Pakistani scams (fake e-challans, courier OTP hijacking, emergency/kidnapping scams, lottery fraud, and BISP/Ehsaas program scams).

It automatically intercepts incoming **text messages, voice notes, images, and PDF documents**, extracts the text from each (transcribing voice, OCR-ing images, reading PDFs), uses OpenRouter LLM APIs to detect suspicious patterns, and replies back with a localized Urdu script response. Voice note responses are generated using high-quality Google TTS.

### Supported message types

| Input | How it's handled |
| --- | --- |
| **Text** | Analyzed directly. |
| **Voice note** | Transcribed (Whisper STT) → analyzed → reply sent as an Urdu voice note. |
| **Image** | Text is OCR-extracted via a vision model → analyzed. (If no text is found, the bot asks for a clearer image.) |
| **PDF** | Text from **only the first 3 pages** is read → analyzed. When the PDF is longer, the reply ends with a note that only the first 3 pages were checked. Non-PDF documents are politely declined. |

---

## Bypassing Expensive APIs (Our Approach)

Traditional WhatsApp bots require setting up the official **Meta WhatsApp Business API** or third-party gateways like **Twilio**. These official channels have severe constraints:
* **High Cost:** Meta charges per conversation, which makes running a free public safety bot financially impossible.
* **Strict Approvals:** Official templates require manual review, and Meta does not allow free-form scanning of forwarded messages.
* **Burdensome Setup:** Registering a business account, getting verified, and setting up webhooks takes days or weeks.

**Our Bypass Solution:**
We bypass all official business APIs and Twilio entirely. By utilizing a virtual WhatsApp Web client (`whatsapp-web.js`), the bot logs in exactly like a regular web client. You simply start the bot, scan the generated **QR Code** in your terminal using your phone, and the bot connects as a linked device. It reads, transcribes, and responds to messages completely free of charge.

---

## Why Docker is Critical

Running headless browser automation and native audio conversion on a remote server is notoriously difficult. This application would **not be possible without Docker** for two main reasons:

1. **Headless Chromium & Puppeteer:** WhatsApp Web automation requires Puppeteer to run a background browser. On a standard VPS/Linux server, Puppeteer frequently crashes due to missing OS-level display and system libraries. Our Docker container bundles Chromium with all necessary shared libraries pre-configured.
2. **Audio Conversion (`ffmpeg`):** To support voice notes, we download and convert WhatsApp Opus audio (.ogg) to MP3 for STT and back. Docker ensures `ffmpeg` and its static libraries are pre-packaged and available on the system path, avoiding manual codec compilation on the server.

---


## Features & Fraud Coverage

The bot is powered by a localized scam database and classification system targeting:

| Scam Category | Target | Indicator |
| --- | --- | --- |
| **Fake E-Challan** | Traffic Fine Scam | Asks for payment on fake sites (non-.gov.pk) |
| **Courier OTP** | WhatsApp Hijacking | Requests 6-digit codes to "release packages" |
| **Fake Kidnapping** | Emergency Impersonation | Demands fast money transfer (Easypaisa/JazzCash) |
| **Fake BISP** | Benazir Income Support | Demands "verification fees" for government aid |
| **Jeeto Pakistan** | Lucky Draw / SIM Lottery | Claims you won prizes you never entered |

---

## Cost Efficiency (Default Config)

The system is optimized for minimal runtime cost:

| Component | Provider / Model | Approximate Cost |
| --- | --- | --- |
| **LLM Analysis** | `google/gemini-2.0-flash-lite-001` | ~$0.0001 / check |
| **Voice Transcription** | `openai/whisper-1` | ~$0.003 / 30s voice note |
| **Voice Synthesis** | `Google Cloud TTS (ur-IN)` → free Google TTS fallback | **~$0–0.001 / reply** |

---

## Voice Synthesis (TTS)

Voice replies use a two-tier strategy so they sound good **and** never break:

1. **Primary — Google Cloud Text-to-Speech** (official, production-grade): natural `ur-IN` Urdu neural voices with no IP rate limits. Enabled by setting `GOOGLE_TTS_API_KEY` in `.env`. Google Cloud's free tier covers ~1M characters/month, so typical usage stays free.
2. **Fallback — free Google Translate TTS**: the original unofficial endpoint. Used automatically when no API key is set, **or** if a Cloud TTS request ever fails. This guarantees voice replies keep working even without a paid key.

To enable the production path: enable the **Cloud Text-to-Speech API** in the Google Cloud Console, create an API key, and set:

```env
GOOGLE_TTS_API_KEY=your_google_cloud_api_key
GOOGLE_TTS_LANGUAGE_CODE=ur-IN
GOOGLE_TTS_VOICE=ur-IN-Wavenet-A
```

---

## Getting Started

### Prerequisites

- **Node.js** (v18 or higher)
- **Ffmpeg** installed on your system path (or run via Docker)

### 1. Clone the repository

```bash
git clone https://github.com/codewithfourtix/sachbatao.git
cd sachbatao
```

### 2. Configure Environment

Copy `.env.example` and set your OpenRouter API key:

```bash
cp .env.example .env
```

Open `.env` and set:
```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Server

```bash
npm start
```

Once running, scan the generated **QR code** in your terminal using your mobile device's WhatsApp app (Settings -> Linked Devices).

---

## Docker Deployment

To run the bot in a headless container environment:

```bash
# Build the container
docker-compose build

# Start the bot
docker-compose up -d

# Check live logs & QR code
docker logs -f whatsapp-fraud-detector
```

---

## Project Structure

```
sachbatao/
├── assets/
│   └── logo.png             # Project logo
├── src/
│   ├── index.js             # Main orchestrator
│   ├── whatsapp-client.js   # WhatsApp web client wrapper
│   ├── fraud-detector.js    # LLM wrapper & analysis logic
│   ├── tts-service.js       # Google TTS wrapper for Urdu voice notes
│   ├── stt-service.js       # OpenRouter Whisper STT integration
│   ├── ocr-service.js       # Image OCR via vision model (extract text)
│   ├── pdf-service.js       # PDF text extraction (first 3 pages only)
│   ├── audio-processor.js   # Ffmpeg format conversions
│   ├── config.js            # Configuration settings & fallback templates
│   ├── logger.js            # Audit and logs recorder
│   └── speech-text.js       # Speech text cleanup helper (strips markdown for TTS)
├── scam_patterns.json       # Scam category database (patterns & keywords)
├── system_prompt.txt        # LLM system behavior instructions & JSON schema
├── Dockerfile               # Docker specification
├── docker-compose.yml       # Docker orchestration config
└── package.json             # Node dependencies and scripts
```

---

## License

MIT — feel free to modify and share!

---

<div align="center">
  <sub>Built for community safety. Keep your family secure.</sub>
</div>
