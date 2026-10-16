#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8095}"
HOST="0.0.0.0"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# Halihazırda bu portta çalışan bir süreç varsa sonlandır
EXISTING_PID=$(lsof -ti :"$PORT" || true)
if [ -n "$EXISTING_PID" ]; then
  echo "Port $PORT üzerinde çalışan mevcut süreç (PID: $EXISTING_PID) kapatılıyor..."
  kill -9 "$EXISTING_PID" || true
  sleep 1
fi

# Çalıştırma motorunu seç (Node.js öncelikli, Python 3 fallback)
if command -v node >/dev/null 2>&1; then
  SERVER_CMD="node backend/server.js"
  RUNTIME="Node.js"
elif command -v python3 >/dev/null 2>&1; then
  SERVER_CMD="python3 backend/server.py"
  RUNTIME="Python 3"
else
  echo "Hata: Ne Node.js ne de Python 3 bulunamadı!" >&2
  exit 1
fi

echo "StrictVideo Backend & Web Sunucusu ($RUNTIME) http://$HOST:$PORT adresinde başlatılıyor..."
PORT="$PORT" HOST="$HOST" nohup $SERVER_CMD > dev_server.log 2>&1 &
SERVER_PID=$!

echo "Sunucu PID: $SERVER_PID ile arka planda başlatıldı ($RUNTIME)."
echo "Erişim Adresi: http://127.0.0.1:$PORT"
sleep 1

if ps -p "$SERVER_PID" > /dev/null; then
  echo "Sunucu başarıyla aktif!"
else
  echo "Hata: Sunucu başlatılamadı!"
  cat dev_server.log
  exit 1
fi
