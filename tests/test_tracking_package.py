# SPDX-License-Identifier: MIT
import hashlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('tracking_server',ROOT/'template/workspace/launchers/PLAYER_SERVER.py')
server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
class TrackingDownloadTests(unittest.TestCase):
 def test_only_missing_files_download_and_hash_is_verified(self):
  data=b'valid tracking file';name='vendor/mediapipe/model.task';sources={name:{'url':'https://example.invalid/model','sha256':hashlib.sha256(data).hexdigest()}}
  with tempfile.TemporaryDirectory() as td,patch.object(server,'TRACKING_DOWNLOADS',sources),patch.object(server,'urlopen',side_effect=lambda *a,**kw:io.BytesIO(data)) as download:
   root=Path(td);server.ensure_tracking_files(root);self.assertEqual((root/name).read_bytes(),data);server.ensure_tracking_files(root);self.assertEqual(download.call_count,1)
   (root/name).write_bytes(b'old');download.side_effect=lambda *a,**kw:io.BytesIO(b'tampered')
   with self.assertRaisesRegex(ValueError,'checksum'):server.ensure_tracking_files(root)
   self.assertEqual((root/name).read_bytes(),b'old');self.assertFalse(list(root.rglob('*.tmp')))
 def test_tracking_sources_match_the_packaged_server(self):
  self.assertEqual(server.TRACKING_DOWNLOADS,json.loads((ROOT/'template/workspace/launchers/TRACKING_DOWNLOADS.json').read_text())['files'])
  self.assertEqual(list(server.TRACKING_FILES),json.loads((ROOT/'template/workspace/launchers/TRACKING_FILES.json').read_text()))
