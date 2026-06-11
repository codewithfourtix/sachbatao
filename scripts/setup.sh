#!/usr/bin/env bash
set -euo pipefail

echo "=== WhatsApp Fraud Detection Setup ==="

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — add your API keys before running."
else
  echo ".env already exists, skipping copy."
fi

mkdir -p temp/audio temp/sessions temp/logs

if [ ! -d node_modules ]; then
  echo "Installing npm dependencies..."
  npm install
else
  echo "node_modules found, skipping npm install."
fi

echo ""
echo "Setup complete. Next steps:"
echo "  1. Edit .env and set OPENROUTER_API_KEY"
echo "  2. Run: npm start"
echo "     Or:  docker-compose up --build"
echo "  3. Scan the QR code in the terminal with WhatsApp"
