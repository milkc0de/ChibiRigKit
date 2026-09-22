import importlib.util,json,tempfile,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('export_output',ROOT/'template/workspace/toolbox/player_output.py');out=importlib.util.module_from_spec(spec);spec.loader.exec_module(out)
class PlayerOutputTests(unittest.TestCase):
    def test_html_and_zip_share_dist_without_touching_character_inputs(self):
        with tempfile.TemporaryDirectory() as td:
            kit=Path(td).resolve();(kit/'package.json').write_text('{"name":"chibirigkit"}')
            root=kit/'characters/hero';root.mkdir(parents=True);(root/'LICENSE.txt').write_text('MIT');(root/'input').mkdir();(root/'input/normal.png').write_bytes(b'original')
            project={'name':'hero','canvas':{'width':100,'height':100},'parts':{'face':{'file':'assets/layers/face.png','image_data_url':'data:image/png;base64,AQID'}},'draw_order':['face']}
            html='<script id="projectData" type="application/json">'+json.dumps(project)+'</script>'
            import os
            from unittest.mock import patch
            with patch.dict(os.environ,{'CHIBIRIG_DIST_ROOT':str(kit/'dist')}):result=out.export_player(root,html,project)
            self.assertEqual(Path(result['html']),kit/'dist/hero/index.html');self.assertEqual(Path(result['zip']),kit/'dist/hero.zip')
            self.assertEqual((root/'input/normal.png').read_bytes(),b'original');self.assertFalse((root/'index.html').exists())
            with zipfile.ZipFile(result['zip']) as z:
                self.assertIsNone(z.testzip());self.assertEqual(z.read('index.html').decode(),html);self.assertEqual(set(z.namelist()),{'index.html','LICENSE.txt',*out.LAUNCHER_NAMES});self.assertEqual(z.read('LICENSE.txt'),b'MIT')
                for name in ['START_SERVER.sh','START_SERVER.command']:
                    self.assertEqual((z.getinfo(name).external_attr>>16)&0o777,0o755)
                    self.assertEqual((Path(result['directory'])/name).stat().st_mode&0o777,0o755)
            self.assertEqual(json.loads((root/'work/player-output.json').read_text()),result)

    def test_reexport_removes_previous_private_artifacts_but_keeps_unrelated_files(self):
        with tempfile.TemporaryDirectory() as td:
            kit=Path(td);(kit/'package.json').write_text('{"name":"chibirigkit"}')
            root=kit/'characters/hero';root.mkdir(parents=True);(root/'LICENSE.txt').write_text('MIT')
            folder=kit/'dist/hero';(folder/'assets').mkdir(parents=True)
            (folder/'rig.project.json').write_text(json.dumps({'parts':{'old':{'file':'assets/old.png'}}}))
            (folder/'assets/old.png').write_bytes(b'private');(folder/'capture.chibimotion.json').write_text('private');(folder/'background.json').write_text('private');(folder/'my-note.txt').write_text('keep');(folder/'README.txt').write_text('old instructions')
            project={'name':'hero','parts':{}};html='<script id="projectData" type="application/json">'+json.dumps(project)+'</script>'
            import os
            from unittest.mock import patch
            with patch.dict(os.environ,{'CHIBIRIG_DIST_ROOT':str(kit/'dist')}):out.export_player(root,html,project)
            for f in ['assets','rig.project.json','README.txt','capture.chibimotion.json','background.json']:self.assertFalse((folder/f).exists())
            self.assertEqual((folder/'my-note.txt').read_text(),'keep')
            self.assertEqual({f.name for f in folder.iterdir()},{'index.html','LICENSE.txt','my-note.txt',*out.LAUNCHER_NAMES})
