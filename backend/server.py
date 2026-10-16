#!/usr/bin/env python3
"""
StrictVideo Backend Server (Python 3 Standart Kütüphane)
SCORM Heartbeat doğrulama ve HMAC-SHA256 sertifika motoru.
Hiçbir harici pip paketi gerektirmez.
"""

import os
import sys
import json
import time
import uuid
import hmac
import hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('PORT', 8095))
HOST = os.environ.get('HOST', '0.0.0.0')
SECRET_KEY = os.environ.get('SECRET_KEY', 'strict-video-hmac-secret-key-2026').encode('utf-8')
VIDEO_TOTAL_DURATION = 120

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Oturum deposu
sessions = {}

def sign_session(session_id: str) -> str:
    return hmac.new(SECRET_KEY, session_id.encode('utf-8'), hashlib.sha256).hexdigest()

def verify_session_token(session_id: str, token: str) -> bool:
    expected = sign_session(session_id)
    return hmac.compare_digest(token, expected)

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.ico': 'image/x-icon'
}

class StrictVideoHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def send_json(self, status_code: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 1. POST /api/v1/session/start
        if path == '/api/v1/session/start':
            session_id = str(uuid.uuid4())
            token = sign_session(session_id)
            now = time.time()

            sessions[session_id] = {
                'sessionId': session_id,
                'token': token,
                'createdAt': now,
                'lastHeartbeatAt': now,
                'lastVerifiedPosition': 0.0,
                'sequence': 0,
                'accumulatedSeconds': 0.0,
                'totalDuration': VIDEO_TOTAL_DURATION,
                'isCompleted': False,
                'violations': []
            }

            return self.send_json(200, {
                'success': True,
                'sessionId': session_id,
                'token': token,
                'totalDuration': VIDEO_TOTAL_DURATION,
                'heartbeatInterval': 3,
                'message': 'Güvenli izleme oturumu başlatıldı. SCORM/Heartbeat takibi devrede.'
            })

        # 2. POST /api/v1/session/heartbeat
        if path == '/api/v1/session/heartbeat':
            content_length = int(self.headers.get('Content-Length', 0))
            raw_body = self.rfile.read(content_length)
            try:
                payload = json.loads(raw_body.decode('utf-8'))
            except Exception:
                return self.send_json(400, {'error': 'Geçersiz JSON yükü'})

            session_id = payload.get('sessionId')
            token = payload.get('token')
            sequence = payload.get('sequence', 0)
            current_pos = float(payload.get('currentPosition', 0.0))
            is_focused = bool(payload.get('isFocused', False))

            if not session_id or session_id not in sessions:
                return self.send_json(401, {'error': 'Geçersiz oturum.'})

            session = sessions[session_id]
            if not verify_session_token(session_id, token):
                return self.send_json(403, {'error': 'Token imza doğrulaması başarısız (HMAC Hatası)!'})

            now = time.time()
            time_diff = now - session['lastHeartbeatAt']

            # Siber Kontrol 1: Replay attack denetimi
            if sequence <= session['sequence']:
                session['violations'].append({'type': 'REPLAY_ATTACK', 'time': now, 'seq': sequence})
                return self.send_json(400, {
                    'error': 'Sıra numarası hatası (Replay Attack şüphesi)!',
                    'expectedSequence': session['sequence'] + 1,
                    'received': sequence
                })

            # Siber Kontrol 2: Rate limit / hızlandırma spam denetimi (minimum 2.0 saniye)
            if time_diff < 2.0:
                session['violations'].append({'type': 'FAST_HEARTBEAT_SPAM', 'time': now, 'diff': time_diff})
                return self.send_json(429, {
                    'error': 'Sinyal anomalisi: Çok hızlı sinyal gönderimi! Hızlandırma tespit edildi.',
                    'timeElapsed': round(time_diff, 2),
                    'minAllowed': 2.0
                })

            # Siber Kontrol 3: İleri sarma pozisyon sıçrama denetimi
            pos_jump = current_pos - session['lastVerifiedPosition']
            if pos_jump > (time_diff + 0.8):
                session['violations'].append({'type': 'FORWARD_SEEK_JUMP', 'time': now, 'jump': pos_jump})
                return self.send_json(400, {
                    'error': 'İleri sarma hilesi algılandı! Video pozisyonu gerçek zamandan daha hızlı ilerledi.',
                    'jump': round(pos_jump, 2),
                    'allowedMax': round(time_diff + 0.8, 2)
                })

            if is_focused:
                valid_inc = min(time_diff, 3.5)
                session['accumulatedSeconds'] += valid_inc

            session['sequence'] = sequence
            session['lastHeartbeatAt'] = now
            session['lastVerifiedPosition'] = current_pos

            if session['accumulatedSeconds'] >= session['totalDuration']:
                session['isCompleted'] = True

            verified_int = min(session['totalDuration'], int(round(session['accumulatedSeconds'])))
            pct = min(100, int(round((session['accumulatedSeconds'] / session['totalDuration']) * 100)))

            return self.send_json(200, {
                'success': True,
                'verifiedSeconds': verified_int,
                'totalDuration': session['totalDuration'],
                'percentage': pct,
                'isCompleted': session['isCompleted'],
                'isFocused': is_focused
            })

        # 3. POST /api/v1/session/claim-certificate
        if path == '/api/v1/session/claim-certificate':
            content_length = int(self.headers.get('Content-Length', 0))
            raw_body = self.rfile.read(content_length)
            try:
                payload = json.loads(raw_body.decode('utf-8'))
            except Exception:
                return self.send_json(400, {'error': 'Geçersiz JSON yükü'})

            session_id = payload.get('sessionId')
            token = payload.get('token')
            student_name = payload.get('studentName', 'Katılımcı')

            if not session_id or session_id not in sessions:
                return self.send_json(401, {'error': 'Geçersiz oturum.'})

            session = sessions[session_id]
            if not verify_session_token(session_id, token):
                return self.send_json(403, {'error': 'Token imza doğrulaması başarısız!'})

            if not session['isCompleted'] or session['accumulatedSeconds'] < session['totalDuration']:
                missing = session['totalDuration'] - int(session['accumulatedSeconds'])
                return self.send_json(403, {
                    'error': 'SUNUCU REDDİ: Yetersiz izleme süresi! Sertifika verilemez.',
                    'requiredSeconds': session['totalDuration'],
                    'actualVerifiedSeconds': int(session['accumulatedSeconds']),
                    'missingSeconds': missing,
                    'message': f'Bu sertifikayı almak için videoyu en az {missing} saniye daha kesintisiz izlemelisiniz.'
                })

            cert_id = f"CERT-FOY-{int(time.time()):X}-{uuid.uuid4().hex[:6].upper()}"
            issue_date = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            sig_payload = f"{cert_id}|{student_name}|{session['totalDuration']}|{issue_date}".encode('utf-8')
            signature = hmac.new(SECRET_KEY, sig_payload, hashlib.sha256).hexdigest()

            return self.send_json(200, {
                'success': True,
                'certificate': {
                    'certId': cert_id,
                    'title': 'Finansal Okuryazarlık ve Güvenlik Bütünlüğü Sertifikası',
                    'recipient': student_name,
                    'verifiedDuration': f"{session['totalDuration']} Saniye (%100 Kesintisiz İzleme)",
                    'status': 'VERIFIED_BY_SERVER',
                    'issuedAt': issue_date,
                    'digitalSignature': signature
                }
            })

        self.send_error(404, 'Endpoint bulunamadı')

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # GET /api/v1/session/status
        if path == '/api/v1/session/status':
            params = parse_qs(parsed.query)
            session_id = params.get('sessionId', [None])[0]
            if not session_id or session_id not in sessions:
                return self.send_json(404, {'error': 'Oturum bulunamadı.'})

            session = sessions[session_id]
            return self.send_json(200, {
                'sessionId': session['sessionId'],
                'verifiedSeconds': int(round(session['accumulatedSeconds'])),
                'totalDuration': session['totalDuration'],
                'isCompleted': session['isCompleted'],
                'violationsCount': len(session['violations'])
            })

        # Statik dosya sunumu
        req_path = '/index.html' if path == '/' else path
        file_path = os.path.abspath(os.path.join(ROOT_DIR, req_path.lstrip('/')))

        if not file_path.startswith(ROOT_DIR) or not os.path.isfile(file_path):
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'404 Dosya Bulunamadi')
            return

        ext = os.path.splitext(file_path)[1].lower()
        content_type = MIME_TYPES.get(ext, 'application/octet-stream')
        file_size = os.path.getsize(file_path)

        # HTTP Range Requests (Video için)
        range_header = self.headers.get('Range')
        if ext == '.mp4' and range_header:
            range_match = range_header.replace('bytes=', '').split('-')
            start = int(range_match[0])
            end = int(range_match[1]) if range_match[1] else file_size - 1
            chunk_length = (end - start) + 1

            self.send_response(206)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
            self.send_header('Content-Length', str(chunk_length))
            self.send_header('Accept-Ranges', 'bytes')
            self.end_headers()

            with open(file_path, 'rb') as f:
                f.seek(start)
                self.wfile.write(f.read(chunk_length))
            return

        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(file_size))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()

        with open(file_path, 'rb') as f:
            self.wfile.write(f.read())

if __name__ == '__main__':
    print(f"[StrictVideo Python Backend] Başlatılıyor: http://{HOST}:{PORT}")
    server = HTTPServer((HOST, PORT), StrictVideoHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
