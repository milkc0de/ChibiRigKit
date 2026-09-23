# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
import json,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]

def make_single(root):
    shutil.copytree(ROOT/'template/workspace',root,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    (root/'work/reference_masks').mkdir(parents=True)
    image=Image.new('RGBA',(128,128),(180,20,30,0));d=ImageDraw.Draw(image);d.ellipse((10,8,118,120),fill='#eabca1')
    features=[]
    for name,x in [('left',27),('right',77)]:
        d.ellipse((x,34,x+23,58),fill='#fff9f0');d.ellipse((x+8,37,x+18,56),fill='#443355')
        mask=Image.new('L',image.size);ImageDraw.Draw(mask).rectangle((x-1,33,x+24,59),fill=255);mask.save(root/f'work/reference_masks/{name}.png')
        features.append({'id':name,'mask':f'work/reference_masks/{name}.png','closed_curve':[[x,47],[x+6,50],[x+17,50],[x+23,47]],'stroke_width':2})
    d.ellipse((55,80,74,94),fill='#9a3048')
    mask=Image.new('L',image.size);ImageDraw.Draw(mask).rectangle((54,79,75,95),fill=255);mask.save(root/'work/reference_masks/mouth.png')
    image.save(root/'input/normal.png')
    cfg=json.loads((root/'character.config.json').read_text());cfg['inputs']={'normal':'normal.png','flat':None,'blink':None,'mouth_closed':None};(root/'character.config.json').write_text(json.dumps(cfg))
    plan={'eyes':features,'mouth':{'id':'mouth','mask':'work/reference_masks/mouth.png','closed_curve':[[55,86],[63,89],[74,86]],'stroke_width':1.5}}
    (root/'reference.plan.json').write_text(json.dumps(plan));return image,cfg

def run(root,name,ok=True):
    result=subprocess.run([sys.executable,str(root/'toolbox'/name)],capture_output=True,text=True)
    if ok and result.returncode:raise AssertionError(result.stderr+result.stdout)
    return result

class ReferenceTests(unittest.TestCase):
    def test_single_image_generates_three_registered_references(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'work') as td:
            root=Path(td);normal,cfg=make_single(root);original=(root/'input/normal.png').read_bytes()
            run(root,'normalize_inputs.py');run(root,'generate_references.py');run(root,'normalize_inputs.py')
            self.assertEqual((root/'input/normal.png').read_bytes(),original)
            manifest=json.loads((root/'work/generated_references/manifest.json').read_text())
            self.assertEqual(set(manifest['roles']),{'flat','blink','mouth_closed'})
            registration=json.loads((root/'work/registration.json').read_text())
            for role in manifest['roles']:
                self.assertTrue(registration['roles'][role]['generated']);self.assertEqual(registration['roles'][role]['matrix'],[[1,0,0],[0,1,0]])
                generated=np.array(Image.open(root/f'work/aligned/{role}.png'))
                self.assertTrue(np.array_equal(np.array(normal)[:,:,3],generated[:,:,3]))
                self.assertGreater(manifest['roles'][role]['changed_pixels'],0)
            # All unchanged skin, hair/body/background pixels are bit-identical.
            a=np.array(normal);b=np.array(Image.open(root/'work/aligned/blink.png'))
            allowed=np.zeros(a.shape[:2],bool);allowed[31:62,24:55]=True;allowed[31:62,74:105]=True
            self.assertTrue(np.array_equal(a[~allowed],b[~allowed]))
            self.assertTrue((root/'checks/generated_references.png').exists())
    def test_supplied_reference_wins_and_cache_expires(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'work') as td:
            root=Path(td);normal,cfg=make_single(root);normal.save(root/'input/blink.png');cfg['inputs']['blink']='blink.png';(root/'character.config.json').write_text(json.dumps(cfg))
            run(root,'normalize_inputs.py');run(root,'generate_references.py');run(root,'normalize_inputs.py')
            manifest=json.loads((root/'work/generated_references/manifest.json').read_text());self.assertNotIn('blink',manifest['roles'])
            registration=json.loads((root/'work/registration.json').read_text());self.assertFalse(registration['roles']['blink']['generated'])
            (root/'work/generated_references/flat.png').write_bytes(b'stale')
            run(root,'normalize_inputs.py');self.assertFalse((root/'work/aligned/flat.png').exists())
    def test_bad_reference_mask_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'work') as td:
            root=Path(td);make_single(root);run(root,'normalize_inputs.py')
            Image.new('L',(128,128),255).save(root/'work/reference_masks/left.png')
            result=run(root,'generate_references.py',False);self.assertNotEqual(result.returncode,0);self.assertIn('too broad',result.stderr)
    def test_closed_source_and_regeneration_drop_stale_masks(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'work') as td:
            root=Path(td);make_single(root);run(root,'normalize_inputs.py');run(root,'generate_references.py')
            path=root/'reference.plan.json';plan=json.loads(path.read_text())
            for eye in plan['eyes']:eye['already_closed']=True
            plan['mouth']=None;path.write_text(json.dumps(plan))
            run(root,'normalize_inputs.py');run(root,'generate_references.py');run(root,'normalize_inputs.py')
            manifest=json.loads((root/'work/generated_references/manifest.json').read_text())
            self.assertNotIn('mouth_closed',manifest['masks'])
            self.assertEqual(manifest['masks']['left_closed'],'work/reference_masks/left.png')
            self.assertEqual(manifest['roles']['blink']['changed_pixels'],0)
            self.assertEqual(manifest['roles']['mouth_closed']['changed_pixels'],0)
    def test_new_character_needs_only_normal(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'work') as td:
            source=Path(td)/'one.png';Image.new('RGBA',(32,32),'white').save(source)
            output=Path(td)/'character'
            result=subprocess.run([sys.executable,str(ROOT/'scripts/new_character.py'),'--normal',str(source),'--output',str(output)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            cfg=json.loads((output/'character.config.json').read_text());self.assertEqual(cfg['name'],'one');self.assertIsNone(cfg['inputs']['flat']);self.assertTrue(cfg['auto_generate_references'])

if __name__=='__main__':unittest.main()
