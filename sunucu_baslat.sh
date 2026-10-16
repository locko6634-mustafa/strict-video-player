#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8095}"
HOST="0.0.0.0"

# Halihazırda bu portta çalışan bir süreç varsa sonlandır
EXISTING_PID=$(lsof -ti :"$PORT" || true)
if [ -n "$EXISTING_PID" ]; then
  echo "Port $PORT üzerinde çalışan mevcut süreç (PID: $EXISTING_PID) kapatılıyor..."
  kill -9 "$EXISTING_PID" || true
  sleep 1
fi

echo "StrictVideo Backend & Web Sunucusu http://$HOST:$PORT adresinde başlatılıyor..."
PORT="$PORT" HOST="$HOST" nohup node backend/server.js > dev_server.log 2>&1 &
SERVER_PID=$!

echo "Sunucu PID: $SERVER_PID ile arka planda başlatıldı."
echo "Erişim Adresi: http://127.0.0.1:$PORT"
sleep 1

if ps -p "$SERVER_PID" > /dev/null; then
  echo "Sunucu başarıyla aktif!"
else
  echo "Hata: Sunucu başlatılamadı!"
  cat dev_server.log
  exit 1
fi
