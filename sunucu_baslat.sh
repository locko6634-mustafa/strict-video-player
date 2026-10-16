#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8095}"
HOST="0.0.0.0"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "StrictVideo Node.js Servisi Hazırlanıyor..."

# 1. Eğer doğrudan sistemde Node.js varsa doğrudan çalıştır
if command -v node >/dev/null 2>&1; then
  EXISTING_PID=$(lsof -ti :"$PORT" || true)
  if [ -n "$EXISTING_PID" ]; then
    echo "Port $PORT üzerinde çalışan mevcut süreç (PID: $EXISTING_PID) kapatılıyor..."
    kill -9 "$EXISTING_PID" || true
    sleep 1
  fi

  echo "StrictVideo Node.js Backend Sunucusu (Doğrudan Node.js) http://$HOST:$PORT adresinde başlatılıyor..."
  PORT="$PORT" HOST="$HOST" nohup node backend/server.js > dev_server.log 2>&1 &
  SERVER_PID=$!
  sleep 1

  if ps -p "$SERVER_PID" > /dev/null; then
    echo "Node.js sunucusu PID $SERVER_PID ile başarıyla aktif!"
    echo "Erişim Adresi: http://127.0.0.1:$PORT"
    exit 0
  else
    echo "Hata: Sunucu başlatılamadı!"
    cat dev_server.log
    exit 1
  fi

# 2. Eğer Node.js yok ama Docker varsa, resmi Node 22 imajıyla Docker Compose üzerinden çalıştır
elif command -v docker >/dev/null 2>&1; then
  echo "Sistemde doğrudan Node.js ikilisi bulunamadı; resmi Node.js 22 imajı (Docker Compose) ile başlatılıyor..."
  docker compose down --remove-orphans >/dev/null 2>&1 || true
  docker compose up -d --build
  echo "StrictVideo Node.js servisi Docker konteyneri içinde başarıyla aktif edildi!"
  echo "Erişim Adresi: http://127.0.0.1:$PORT"
  exit 0

else
  echo "Hata: Projeyi çalıştırmak için sistemde Node.js veya Docker bulunmalıdır!" >&2
  exit 1
fi
