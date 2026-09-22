import contextlib,copy,http.client,importlib.util,json,tempfile,threading,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('player_sync_server',ROOT/'template/workspace/launchers/PLAYER_SERVER.py')
server_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(server_module)

class PlayerSyncServerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();root=Path(self.temp.name)
        (root/'index.html').write_text('<html><head></head><body>player</body></html>');(root/'LICENSE.txt').write_text('MIT');(root/'private.txt').write_text('private')
        self.server=server_module.PlayerServer(root,0);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.port=self.server.server_port
        self.state={'motion':{'format':'chibirigkit.motion'},'background':{},'extras':{},'playback':{},'capture':None}
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join(3);self.temp.cleanup()
    def request(self,method,path,body=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.port,timeout=3)
        with contextlib.closing(connection):
            connection.request(method,path,body,headers or {});response=connection.getresponse();return response.status,response.read()
    def post(self,state=None,headers=None):
        body=json.dumps({'character':self.server.character,'state':self.state if state is None else state})
        return self.request('POST','/api/player-sync/state',body,{'Content-Type':'application/json','X-ChibiRig-Sync-Token':self.server.token,**(headers or {})})
    def event(self,response):
        lines=[]
        while True:
            line=response.readline().decode().rstrip('\n')
            if not line:
                if any(line.startswith('data: ') for line in lines):break
                lines=[];continue
            lines.append(line)
        return json.loads(next(line[6:] for line in lines if line.startswith('data: ')))
    def test_bootstrap_roles_loopback_and_private_files(self):
        self.assertEqual(self.server.server_address[0],'127.0.0.1')
        for route,role in [('/','control'),('/obs','view')]:
            status,html=self.request('GET',route);self.assertEqual(status,200);self.assertIn(('"role": "'+role+'"').encode(),html)
        for route in ['/private.txt','/../private.txt','/PLAYER_SERVER.py']:
            self.assertEqual(self.request('GET',route)[0],404)
        self.assertEqual(self.request('GET','/api/player-sync/session',headers={'Host':'evil.example'})[0],403)
        self.assertEqual(self.request('GET','/',headers={'Origin':'https://evil.example'})[0],403)
    def test_sse_live_update_and_late_subscriber_receive_latest_state(self):
        with contextlib.closing(http.client.HTTPConnection('127.0.0.1',self.port,timeout=3)) as connection:
            connection.request('GET','/api/player-sync/events?token='+self.server.token);response=connection.getresponse()
            self.assertEqual(response.status,200);self.assertIsNone(self.event(response)['state']);self.assertEqual(self.event(response)['active'],False)
            self.state['extras']['hairPhysicsAmount']=1.5;self.assertEqual(self.post()[0],200)
            event=self.event(response);self.assertEqual(event['revision'],1);self.assertEqual(event['state'],self.state)
        with contextlib.closing(http.client.HTTPConnection('127.0.0.1',self.port,timeout=3)) as connection:
            connection.request('GET','/api/player-sync/events?token='+self.server.token);self.assertEqual(self.event(connection.getresponse())['state'],self.state)
        self.assertEqual(json.loads(self.request('GET','/api/player-sync/state')[1])['state'],self.state)
        self.assertEqual({p.name for p in Path(self.temp.name).iterdir()},{'index.html','LICENSE.txt','private.txt'})
    def test_unauthorized_and_invalid_updates_do_not_replace_state(self):
        self.assertEqual(self.post()[0],200)
        self.assertEqual(self.post(headers={'X-ChibiRig-Sync-Token':'wrong'})[0],403)
        self.assertEqual(self.post(headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.post({'deviceId':'private'})[0],400)
        self.assertEqual(self.request('POST','/api/player-sync/state','[]',{'Content-Type':'application/json','X-ChibiRig-Sync-Token':self.server.token})[0],400)
        self.assertEqual(self.server.revision,1);self.assertEqual(self.server.state,self.state)
    def test_restart_discards_state_and_rotates_token(self):
        self.post()
        with server_module.PlayerServer(self.temp.name,0) as fresh:
            self.assertIsNone(fresh.state);self.assertNotEqual(fresh.token,self.server.token)

    def test_tracking_assets_have_correct_mime_and_private_paths_stay_blocked(self):
        root=Path(self.temp.name)
        self.assertFalse(json.loads(self.request('GET','/api/tracking')[1])['camera'])
        for name in server_module.TRACKING_FILES:
            target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'fixture')
        self.assertTrue(json.loads(self.request('GET','/api/tracking')[1])['camera'])
        with contextlib.closing(http.client.HTTPConnection('127.0.0.1',self.port)) as connection:
            connection.request('GET','/vendor/mediapipe/wasm/vision_wasm_internal.wasm');response=connection.getresponse();self.assertEqual(response.status,200);self.assertEqual(response.getheader('Content-Type'),'application/wasm');self.assertEqual(response.read(),b'fixture')
        (root/'vendor/mediapipe/private.txt').write_text('secret')
        self.assertEqual(self.request('GET','/vendor/mediapipe/private.txt')[0],404)
        self.assertEqual(self.request('POST','/api/tracking/setup')[0],403)
        target=root/'runtime/tracking_worker.js';target.unlink();target.symlink_to(root/'private.txt')
        self.assertEqual(self.request('GET','/runtime/tracking_worker.js')[0],403)
