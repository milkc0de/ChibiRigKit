import contextlib,json,os,shutil,signal,socket,subprocess,tempfile,time,unittest,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
LAUNCHERS=ROOT/'template/workspace/launchers'

@unittest.skipIf(os.name=='nt','POSIX launchers are exercised on macOS/Linux')
class PlayerLauncherTests(unittest.TestCase):
    def fixture(self,base):
        player=base/'完成品 space & player';player.mkdir()
        for file in LAUNCHERS.iterdir():
            if file.is_file():shutil.copy2(file,player/file.name)
        (player/'index.html').write_text('<p>local player</p>')
        return player

    def test_shell_and_mac_launchers_detect_python_and_anchor_directory(self):
        for launcher in ['START_SERVER.sh','START_SERVER.command']:
            for fallback in [False,True]:
                with self.subTest(launcher=launcher,fallback=fallback),tempfile.TemporaryDirectory() as td:
                    base=Path(td);player=self.fixture(base);bindir=base/'bin';bindir.mkdir();log=base/'arguments'
                    good='#!/bin/sh\nif [ "$1" = "-c" ]; then exit 0; fi\nprintf "%s\\n" "$@" > "$CHIBIRIG_ARGS_LOG"\n'
                    for name,source in [('python3','#!/bin/sh\nexit 1\n' if fallback else good),('python',good)]:
                        p=bindir/name;p.write_text(source);p.chmod(0o755)
                    env={**os.environ,'PATH':str(bindir)+':/usr/bin:/bin','CHIBIRIG_ARGS_LOG':str(log)}
                    result=subprocess.run(['/bin/sh',str(player/launcher)],cwd=base,env=env,capture_output=True,text=True,timeout=5)
                    self.assertEqual(result.returncode,0,result.stderr)
                    self.assertEqual(log.read_text().splitlines(),[str(player/'PLAYER_SERVER.py')])
                    self.assertIn('インターネットには公開されず',result.stdout)
                    self.assertIn('同じWi-Fiの別の端末からもアクセスできません',result.stdout)

    def test_missing_html_does_not_start_server(self):
        with tempfile.TemporaryDirectory() as td:
            player=self.fixture(Path(td));(player/'index.html').unlink()
            result=subprocess.run(['/bin/sh',str(player/'START_SERVER.sh')],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,1);self.assertIn('ZIPをすべて展開',result.stderr)

    def test_actual_python_server_serves_finished_folder_from_another_cwd(self):
        with contextlib.closing(socket.socket()) as probe:
            try:probe.bind(('127.0.0.1',5510))
            except OSError:self.skipTest('Port 5510 is already used by the user')
        with tempfile.TemporaryDirectory() as td:
            base=Path(td);player=self.fixture(base);(base/'private.txt').write_text('outside')
            with (base/'server.log').open('w+') as log:
                process=subprocess.Popen(['/bin/sh',str(player/'START_SERVER.sh')],cwd=base,env={**os.environ,'PYTHONUNBUFFERED':'1'},stdout=log,stderr=log,start_new_session=True)
                try:
                    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));html=None
                    for _ in range(60):
                        if process.poll() is not None:break
                        try:
                            with opener.open('http://127.0.0.1:5510/',timeout=.3) as response:html=response.read();break
                        except OSError:time.sleep(.05)
                    log.flush();log.seek(0);output=log.read()
                    self.assertEqual(html,b'<p>local player</p>',output)
                    self.assertIn('OBSのブラウザソース：http://127.0.0.1:5510/obs',output)
                    with self.assertRaises(urllib.error.HTTPError) as error:opener.open('http://127.0.0.1:5510/private.txt',timeout=1)
                    self.assertEqual(error.exception.code,404)
                finally:
                    if process.poll() is None:os.killpg(process.pid,signal.SIGTERM)
                    process.wait(timeout=5)
