Write-Host "=== WhatsApp Fraud Detection Setup ===" -ForegroundColor Cyan

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example — add your API keys before running."
} else {
    Write-Host ".env already exists, skipping copy."
}

New-Item -ItemType Directory -Force -Path "temp/audio", "temp/sessions", "temp/logs" | Out-Null

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing npm dependencies..."
    npm install
} else {
    Write-Host "node_modules found, skipping npm install."
}

Write-Host ""
Write-Host "Setup complete. Next steps:"
Write-Host "  1. Edit .env and set OPENROUTER_API_KEY"
Write-Host "  2. Run: npm start"
Write-Host "     Or:  docker-compose up --build"
Write-Host "  3. Scan the QR code in the terminal with WhatsApp"
