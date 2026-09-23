# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
"""Synthetic art isolates regressions without shipping another character's assets."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
FIXTURE=ROOT/'work/regression-character'

def run(script, ok=True):
    result=subprocess.run([sys.executable, str(FIXTURE/'toolbox'/script)],cwd=FIXTURE,text=True,capture_output=True,
                          env={**os.environ,'PYTHONPYCACHEPREFIX':str(ROOT/'work/pycache')})
    if ok and result.returncode:
        raise AssertionError(result.stderr+result.stdout)
    return result


def make_fixture():
    if FIXTURE.exists():shutil.rmtree(FIXTURE)
    shutil.copytree(ROOT/'template/workspace',FIXTURE)
    (FIXTURE/'work/masks').mkdir(parents=True)
    normal=Image.new('RGBA',(128,160));d=ImageDraw.Draw(normal)
    d.ellipse((24,8,104,94),fill='#ffd1a6');d.rectangle((32,91,96,146),fill='#a6c8ff')
    d.ellipse((39,35,55,53),fill='#372424');d.ellipse((72,35,88,53),fill='#372424')
    d.ellipse((56,64,73,79),fill='#be335a');d.ellipse((31,56,44,61),fill='#f78cac')
    d.rectangle((14,96,33,122),fill='#ce6a7a')
    normal.save(FIXTURE/'input/normal.png')
    flat=normal.copy();d=ImageDraw.Draw(flat)
    for bb in [(39,35,55,53),(72,35,88,53),(56,64,73,79)]:d.rectangle(bb,fill='#ffd1a6')
    d.rectangle((31,56,44,61),fill='#ffd1a6')
    flat.save(FIXTURE/'input/flat.png')
    blink=normal.copy();d=ImageDraw.Draw(blink)
    for x in (39,72):d.rectangle((x,35,x+16,53),fill='#ffd1a6');d.line((x,47,x+16,45),fill='#372424',width=2)
    blink.save(FIXTURE/'input/blink.png')
    closed=normal.copy();d=ImageDraw.Draw(closed);d.rectangle((56,64,73,79),fill='#ffd1a6');d.line((58,73,72,71),fill='#be335a',width=2);closed.save(FIXTURE/'input/mouth_closed.png')
    cfg=json.loads((FIXTURE/'character.config.json').read_text());cfg['inputs']={'normal':'normal.png','blink':'blink.png','mouth_closed':'mouth_closed.png','flat':'flat.png'}
    (FIXTURE/'character.config.json').write_text(json.dumps(cfg))
    run('normalize_inputs.py')
    # Expressions already share coordinates: explicitly register identity for a deterministic fixture.
    for role in ('normal','flat','blink','mouth_closed'):shutil.copy2(FIXTURE/f'input/{role}.png',FIXTURE/f'work/aligned/{role}.png')
    sys.path.insert(0,str(FIXTURE/'toolbox'))
    from rig_contract import snapshot
    (FIXTURE/'work/source_hashes.json').write_text(json.dumps(snapshot(FIXTURE)))
    base=normal.getchannel('A');draw=ImageDraw.Draw(base)
    draw.rectangle((14,96,31,122),fill=0)
    base.save(FIXTURE/'work/masks/base.png')
    parts=[{'id':'base','source':'flat','mask':'work/masks/base.png','role':'base','kind':'static'}]
    for label,x in [('left',39),('right',72)]:
        for state,source,kind in [('open','normal','eye_open'),('closed','blink','drawn_eye_closed')]:
            mask=Image.new('L',normal.size);md=ImageDraw.Draw(mask)
            if state=='open':md.ellipse((x,35,x+16,53),fill=255)
            else:md.line((x,47,x+16,45),fill=255,width=2)
            pid=f'{label}_{state}';mask.save(FIXTURE/f'work/masks/{pid}.png')
            spec={'id':pid,'source':source,'mask':f'work/masks/{pid}.png','role':'eye','kind':kind}
            if state=='open':spec.update(closed_part=f'{label}_closed',mesh={'type':'blink_eye_radial','close_curve':{'x':x+8,'y':46,'curvature':.012}})
            parts.append(spec)
    for state,source,kind in [('open','normal','mouth_open'),('closed','mouth_closed','mouth_closed')]:
        mask=Image.new('L',normal.size);d=ImageDraw.Draw(mask)
        if state=='open':d.ellipse((56,64,73,79),fill=255)
        else:d.line((58,73,72,71),fill=255,width=2)
        pid=f'mouth_{state}';mask.save(FIXTURE/f'work/masks/{pid}.png')
        spec={'id':pid,'source':source,'mask':f'work/masks/{pid}.png','role':'mouth','kind':kind}
        if state=='open':spec['closed_part']='mouth_closed'
        parts.append(spec)
    mask=Image.new('L',normal.size);ImageDraw.Draw(mask).rectangle((14,96,30,122),fill=255);mask.save(FIXTURE/'work/masks/arm.png')
    seam=Image.new('RGBA',normal.size,'#ce6a7a');seam.save(FIXTURE/'work/seam.png')
    mask=Image.new('L',normal.size);ImageDraw.Draw(mask).rectangle((29,100,33,117),fill=255);mask.save(FIXTURE/'work/masks/joint.png')
    parts.insert(1,{'id':'arm','source':'normal','mask':'work/masks/arm.png','role':'arm','kind':'normal',
                    'mesh':{'type':'soft_body','amp_px':.25},'seam':{'file':'work/seam.png','mask':'work/masks/joint.png'}})
    mask=Image.new('L',normal.size);ImageDraw.Draw(mask).ellipse((31,56,44,61),fill=255);mask.save(FIXTURE/'work/masks/blush.png')
    parts.insert(2,{'id':'blush','source':'normal','mask':'work/masks/blush.png','role':'face','kind':'blush'})
    smile=copy.deepcopy(next(p for p in parts if p['id']=='mouth_open'))
    smile.update(id='mouth_smile',kind='mouth_smile',transform_from='mouth_open')
    parts.insert(len(parts)-1,smile)
    plan={'name':'Regression <rig> </script>','parts':parts,'draw_order':[p['id'] for p in parts]}
    (FIXTURE/'rig.plan.json').write_text(json.dumps(plan))
    run('build_project.py');run('validate_character.py')
    return plan


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.plan=make_fixture()
    def setUp(self):
        (FIXTURE/'rig.plan.json').write_text(json.dumps(self.plan))
    def test_embedded_integrity(self):
        run('build_project.py');run('validate_character.py')
        text=(FIXTURE/'work/player/index.html').read_text()
        self.assertIn('\\u003c/script>',text)
        self.assertIn('&lt;rig&gt;',text)
    def test_duplicate_and_missing_order(self):
        for order in [['base','base'],self.plan['draw_order'][:-1]]:
            plan=copy.deepcopy(self.plan);plan['draw_order']=order
            (FIXTURE/'rig.plan.json').write_text(json.dumps(plan))
            self.assertNotEqual(run('build_project.py',False).returncode,0)
    def test_unsafe_id_and_reference(self):
        for field,value in [('id','../escape'),('parent','missing'),('transform_from','missing')]:
            plan=copy.deepcopy(self.plan);plan['parts'][0][field]=value
            (FIXTURE/'rig.plan.json').write_text(json.dumps(plan))
            self.assertNotEqual(run('build_project.py',False).returncode,0)
    def test_source_mutation(self):
        path=FIXTURE/'input/normal.png';original=path.read_bytes()
        try:
            path.write_bytes(original+b'changed')
            self.assertIn('Immutable',run('build_project.py',False).stderr)
        finally:path.write_bytes(original)
    def test_stale_embedded_data(self):
        run('build_project.py');path=FIXTURE/'work/player/index.html';original=path.read_text()
        try:
            path.write_text(original.replace('"version":2','"version":99'))
            self.assertIn('differs',run('validate_character.py',False).stderr)
        finally:path.write_text(original)
    def test_eye_pair_and_radial_geometry(self):
        run('build_project.py');p=json.loads((FIXTURE/'rig.project.json').read_text())['parts']
        self.assertEqual(p['left_closed']['transform_from'],'left_open')
        self.assertEqual(len(p['left_open']['mesh']['radii']),48)
        self.assertEqual(p['mouth_open']['mesh']['type'],'mouth_open_close')
    def test_runtime_syntax(self):
        run('build_project.py')
        html=(FIXTURE/'work/player/index.html').read_text()
        code=html.split('<script>')[1].split('</script>')[0]
        script=ROOT/'work/runtime-syntax.cjs';script.write_text(code)
        result=subprocess.run(['node','--check',str(script)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
    def test_repair_is_local_and_seam_is_bounded(self):
        run('build_project.py')
        project=json.loads((FIXTURE/'rig.project.json').read_text());part=project['parts']['arm']
        before=Image.open(FIXTURE/part['file']).convert('RGBA')
        patch=Image.new('RGBA',(128,160),'#00ff00');patch.save(FIXTURE/'work/repair.png')
        mask=Image.new('L',(128,160));ImageDraw.Draw(mask).rectangle((20,103,22,105),fill=255);mask.save(FIXTURE/'work/masks/repair.png')
        plan=copy.deepcopy(self.plan)
        arm=next(p for p in plan['parts'] if p['id']=='arm')
        arm['texture_repair']={'file':'work/repair.png','mask':'work/masks/repair.png'}
        (FIXTURE/'rig.plan.json').write_text(json.dumps(plan));run('build_project.py')
        after=Image.open(FIXTURE/part['file']).convert('RGBA')
        changed=0
        for y in range(before.height):
            for x in range(before.width):
                if before.getpixel((x,y))!=after.getpixel((x,y)):
                    changed+=1;self.assertTrue(20<=x+part['x']<=22 and 103<=y+part['y']<=105)
        self.assertEqual(changed,9)
        seam=Image.open(FIXTURE/part['seam']['file']).convert('RGBA')
        self.assertEqual(seam.size,before.size)
        for y in range(seam.height):
            for x in range(seam.width):
                if seam.getpixel((x,y))[3]:self.assertTrue(29<=x+part['x']<=33 and 100<=y+part['y']<=117)
    def test_stale_seam_rejected(self):
        run('build_project.py')
        project=json.loads((FIXTURE/'rig.project.json').read_text())
        path=FIXTURE/project['parts']['arm']['seam']['file'];original=path.read_bytes()
        try:
            path.write_bytes(original+b'stale')
            self.assertIn('seam data is stale',run('validate_character.py',False).stderr)
        finally:path.write_bytes(original)
    @classmethod
    def tearDownClass(cls):
        (FIXTURE/'rig.plan.json').write_text(json.dumps(cls.plan));run('build_project.py');run('validate_character.py')

if __name__=='__main__':unittest.main()
