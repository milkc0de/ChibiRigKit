#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Loopback-only player and in-memory settings relay. Python standard library only."""
import argparse, hashlib, json, secrets, threading, math, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

LIVE_KEYS = {'headYaw','headPitch','headRoll','eyeLeft','eyeRight','gazeX','gazeY','mouthOpen','mouthShape','browLeftX','browRightX','browLeftY','browRightY','browLeftAngle','browRightAngle','browLeftShape','browRightShape'}
MAX_BODY = 32 * 1024 * 1024
CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"

def validate_state(state):
    if not isinstance(state, dict) or set(state) != {'motion', 'background', 'extras', 'playback', 'capture'}:
        raise ValueError('共有する設定の形式が不正です')
    if not isinstance(state['motion'], dict) or state['motion'].get('format') != 'chibirigkit.motion':
        raise ValueError('モーション設定が不正です')
    if not all(isinstance(state[k], dict) for k in ['background', 'extras', 'playback']):
        raise ValueError('共有する設定の形式が不正です')
    if state['capture'] is not None:
        capture = state['capture']
        if not isinstance(capture, dict) or set(capture) != {'source', 'playing', 'offset', 'hold', 'speed', 'loop'}:
            raise ValueError('モーション再生設定が不正です')
        if not isinstance(capture['source'], dict) or set(capture['source']) != {'format', 'version', 'timeUnit', 'duration', 'loop', 'channels', 'frames'}:
            raise ValueError('モーションの付加情報は共有できません')
    json.dumps(state, allow_nan=False)

class PlayerServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    def __init__(self, root, port=5510):
        self.root = Path(root).resolve()
        self.html = (self.root / 'index.html').read_text(encoding='utf-8')
        self.character = hashlib.sha256(self.html.encode()).hexdigest()
        self.token = secrets.token_urlsafe(32)
        self.condition = threading.Condition()
        self.revision = 0
        self.state = None
        self.live = {'active':False,'values':{}}
        self.live_revision = 0
        self.stopping = False
        super().__init__(('127.0.0.1', port), PlayerHandler)
    def snapshot(self):
        # The caller holds the condition; committed dictionaries are immutable.
        return {'character': self.character, 'revision': self.revision, 'state': self.state}
    def server_close(self):
        with self.condition:
            self.stopping = True
            self.condition.notify_all()
        super().server_close()

class PlayerHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_args):
        pass  # Do not log settings, tokens, filenames or request URLs.
    def allowed(self):
        port = self.server.server_port
        hosts = {'127.0.0.1:'+str(port), 'localhost:'+str(port)}
        origin = self.headers.get('Origin')
        return (self.headers.get('Host') in hosts
                and (origin is None or origin in {'http://'+host for host in hosts})
                and self.headers.get('Sec-Fetch-Site') not in {'cross-site'})
    def send(self, status, data, mime='application/json; charset=utf-8'):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', CSP)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)
    def do_HEAD(self):
        self.do_GET()
    def do_GET(self):
        if not self.allowed():
            return self.send(403, {'error':'このPCの画面からのみ利用できます'})
        url = urlsplit(self.path)
        if url.path in {'/', '/index.html', '/obs'}:
            role = 'view' if url.path == '/obs' else 'control'
            config = '<script id="playerSyncConfig" type="application/json">'+json.dumps({'role':role})+'</script>'
            html = self.server.html.replace('<head>', '<head>\n'+config, 1)
            return self.send(200, html.encode(), 'text/html; charset=utf-8')
        if url.path == '/LICENSE.txt':
            return self.send(200, (self.server.root/'LICENSE.txt').read_bytes(), 'text/plain; charset=utf-8')
        if url.path == '/api/player-sync/session':
            return self.send(200, {'token':self.server.token, 'character':self.server.character})
        if url.path == '/api/player-sync/state':
            with self.server.condition:
                state = self.server.snapshot()
            return self.send(200, state)
        if url.path == '/api/player-sync/events' and self.command != 'HEAD':
            token = parse_qs(url.query).get('token', [''])[0]
            if not secrets.compare_digest(token.encode(), self.server.token.encode()):
                return self.send(403, {'error':'再接続してください'})
            return self.events()
        return self.send(404, {'error':'ファイルまたは操作がありません'})
    def do_POST(self):
        self.close_connection = True
        if not self.allowed() or not secrets.compare_digest(self.headers.get('X-ChibiRig-Sync-Token', '').encode(), self.server.token.encode()):
            return self.send(403, {'error':'操作画面からのみ変更できます'})
        if self.path not in {'/api/player-sync/state','/api/player-sync/live'}:
            return self.send(404, {'error':'操作がありません'})
        try:
            size = int(self.headers.get('Content-Length', '-1'))
            if size < 0 or size > MAX_BODY:
                return self.send(413, {'error':'共有データは32MB以内にしてください'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.send(415, {'error':'JSONが必要です'})
            self.connection.settimeout(10)
            def invalid_constant(_value):
                raise ValueError('有限の数値が必要です')
            data = json.loads(self.rfile.read(size), parse_constant=invalid_constant)
            if not isinstance(data, dict):
                raise ValueError('JSON object is required')
            if data.get('character') != self.server.character:
                return self.send(409, {'error':'キャラが切り替わりました。画面を再読み込みしてください'})
            if self.path.endswith('/live'):
                live = data['live']
                if (not isinstance(live, dict) or not isinstance(live.get('active'), bool)
                        or not isinstance(live.get('values'), dict)
                        or any(k not in LIVE_KEYS or not isinstance(v, (int,float)) or isinstance(v,bool)
                               or not math.isfinite(v) or abs(v)>1000 for k,v in live['values'].items())):
                    raise ValueError('Invalid live values')
                with self.server.condition:
                    self.server.live = {'active':live['active'], 'values':live['values'] if live['active'] else {}, 'updatedAt':time.time()*1000}
                    self.server.live_revision += 1
                    self.server.condition.notify_all()
                return self.send(200, {'ok':True})
            validate_state(data['state'])
            with self.server.condition:
                self.server.state = data['state']
                self.server.revision += 1
                revision = self.server.revision
                self.server.condition.notify_all()
            return self.send(200, {'revision':revision})
        except (ValueError, TypeError, KeyError, RecursionError):
            return self.send(400, {'error':'共有データが不正です'})
    def events(self):
        self.connection.settimeout(5)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'close')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.close_connection = True
        revision = -1
        live_revision = -1
        try:
            while True:
                with self.server.condition:
                    if revision == self.server.revision and live_revision == self.server.live_revision and not self.server.stopping:
                        self.server.condition.wait(timeout=10)
                    if self.server.stopping:
                        return
                    snapshot = self.server.snapshot()
                    live = self.server.live
                    latest_live_revision = self.server.live_revision
                if snapshot['revision'] != revision:
                    payload = json.dumps(snapshot, ensure_ascii=False, allow_nan=False)
                    self.wfile.write(('event: settings\ndata: '+payload+'\n\n').encode())
                    revision = snapshot['revision']
                if latest_live_revision != live_revision:
                    self.wfile.write(('event: live\ndata: '+json.dumps(live, allow_nan=False)+'\n\n').encode())
                    live_revision = latest_live_revision
                else:
                    self.wfile.write(b': keepalive\n\n')
                self.wfile.flush()
        except (ConnectionError, TimeoutError, OSError):
            pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5510)
    args = parser.parse_args()
    try:
        server = PlayerServer(Path(__file__).resolve().parent, args.port)
    except (OSError, ValueError) as error:
        print('起動できません。ZIPの展開と、同じポートのサーバーが起動していないか確認してください。', flush=True)
        raise SystemExit(1) from error
    print('このPCの中だけで動く表示・設定共有用サーバーです。', flush=True)
    print('インターネットには公開されず、同じWi-Fiの別の端末からもアクセスできません。', flush=True)
    print('設定はメモリー内だけで共有し、サーバー終了時に破棄します。', flush=True)
    print('操作画面：http://127.0.0.1:%s/' % server.server_port, flush=True)
    print('OBSのブラウザソース：http://127.0.0.1:%s/obs' % server.server_port, flush=True)
    print('OBSの幅・高さは1280×720などに設定してください。終了はCtrl+Cです。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
