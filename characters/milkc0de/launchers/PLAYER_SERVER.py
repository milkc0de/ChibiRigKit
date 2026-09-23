#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
"""Loopback-only player and in-memory settings relay. Python standard library only."""
import argparse, hashlib, json, secrets, threading, math, time, os
from urllib.request import urlopen
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

LIVE_KEYS = {'headYaw','headPitch','headRoll','eyeLeft','eyeRight','gazeX','gazeY','mouthOpen','mouthShape','browLeftX','browRightX','browLeftY','browRightY','browLeftAngle','browRightAngle','browLeftShape','browRightShape'}
TRACKING_FILES = ('runtime/tracking_worker.js', 'vendor/mediapipe/vision_bundle.js', 'vendor/mediapipe/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm', 'vendor/mediapipe/models/face_landmarker.task', 'licenses/mediapipe-LICENSE.txt', 'licenses/mediapipe-NOTICES.txt')
TRACKING_DOWNLOADS = {'vendor/mediapipe/vision_bundle.js': {'url': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.js', 'sha256': '98db72469ffb176f5e9f2687be0f70783893aca681f7789c34b872b0a764371a'}, 'vendor/mediapipe/wasm/vision_wasm_internal.js': {'url': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.js', 'sha256': 'e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73'}, 'vendor/mediapipe/wasm/vision_wasm_internal.wasm': {'url': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.wasm', 'sha256': '8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886'}, 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js': {'url': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_nosimd_internal.js', 'sha256': 'e81d715a3d42cc3373602eb2f7aff795d164934db680e32496b65dab537f9658'}, 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm': {'url': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_nosimd_internal.wasm', 'sha256': 'a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192'}, 'vendor/mediapipe/models/face_landmarker.task': {'url': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', 'sha256': '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'}}
DOWNLOAD_LOCK = threading.Lock()
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

def ensure_tracking_files(root):
    root=Path(root).resolve()
    with DOWNLOAD_LOCK:
        for name,source in TRACKING_DOWNLOADS.items():
            target=root/name
            # Only fixed upstream files under the package may be written.
            if root not in target.resolve().parents or target.is_symlink():raise ValueError('Unsafe tracking path')
            if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest()==source['sha256']:continue
            target.parent.mkdir(parents=True,exist_ok=True)
            temporary=target.with_name(target.name+'.'+secrets.token_hex(8)+'.tmp')
            try:
                digest=hashlib.sha256();size=0
                with urlopen(source['url'],timeout=45) as response,temporary.open('xb') as output:
                    while True:
                        chunk=response.read(1024*1024)
                        if not chunk:break
                        size+=len(chunk)
                        if size>32*1024*1024:raise ValueError('Tracking download too large')
                        digest.update(chunk);output.write(chunk)
                if digest.hexdigest()!=source['sha256']:raise ValueError('Tracking download checksum mismatch')
                os.replace(temporary,target)
            finally:
                if temporary.exists():temporary.unlink()

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
        if url.path == '/api/tracking':
            return self.send(200, {'camera':all((self.server.root/name).is_file() and not (self.server.root/name).is_symlink() for name in TRACKING_FILES), 'setupToken':self.server.token})
        name = url.path.lstrip('/')
        if name in TRACKING_FILES:
            target = self.server.root/name
            try:
                resolved = target.resolve(strict=True)
                if self.server.root not in resolved.parents or any(p.is_symlink() for p in [target,*target.parents] if p != self.server.root and self.server.root in p.parents):
                    return self.send(403, {'error':'Forbidden'})
                if not resolved.is_file():raise FileNotFoundError()
                mime = {'.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.task':'application/octet-stream','.txt':'text/plain; charset=utf-8'}[target.suffix]
                return self.send(200, resolved.read_bytes(), mime)
            except OSError:
                return self.send(404, {'error':'追跡ファイルがありません。完成品ZIPをすべて展開してください'})
        if url.path == '/LICENSE.txt':
            return self.send(200, (self.server.root/'LICENSE.txt').read_bytes(), 'text/plain; charset=utf-8')
        if url.path == '/MEDIA_NOTICE.txt':
            return self.send(200, (self.server.root/'MEDIA_NOTICE.txt').read_bytes(), 'text/plain; charset=utf-8')
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
        if self.path == '/api/tracking/setup':
            if not self.allowed() or not secrets.compare_digest(self.headers.get('X-ChibiRig-Token','').encode(),self.server.token.encode()):
                return self.send(403, {'error':'操作画面からのみ準備できます'})
            try:
                ensure_tracking_files(self.server.root)
                if not all((self.server.root/name).is_file() for name in TRACKING_FILES):raise ValueError('Worker or license files missing')
                return self.send(200, {'camera':True})
            except (OSError,ValueError):
                return self.send(503, {'error':'追跡ファイルを取得できませんでした。インターネット接続と、完成品ZIP全体の展開を確認してください'})
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
