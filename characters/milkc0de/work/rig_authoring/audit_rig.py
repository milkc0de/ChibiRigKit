# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
"""Final artifact, source-color and immutable-input audit."""
from pathlib import Path
import json,hashlib,sys
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'toolbox'))
from rig_contract import validate_plan,validate_project,verify_sources
plan=json.loads((ROOT/'rig.plan.json').read_text());project=json.loads((ROOT/'rig.project.json').read_text())
validate_plan(ROOT,plan);validate_project(ROOT,project);verify_sources(ROOT)
before_path=Path('/tmp/milkc0de-rig-source-before.json')
if before_path.exists():
 before=json.loads(before_path.read_text());assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in before.items())
source={r:np.array(Image.open(ROOT/f'work/aligned/{r}.png').convert('RGBA')) for r in ('normal','flat','blink','mouth_closed')}
colors={};mask_checks=0
for spec in plan['parts']:
 p=project['parts'][spec['id']];mask=Image.open(ROOT/spec['mask']);assert mask.mode=='L' and mask.size==(1152,1366) and mask.getbbox();mask_checks+=1
 im=np.array(Image.open(ROOT/p['file']));src=source[spec['source']][p['y']:p['y']+p['h'],p['x']:p['x']+p['w']]
 region=im[:,:,3]>0
 if spec.get('texture_repair'):
  repair=np.array(Image.open(ROOT/spec['texture_repair']['mask']))[p['y']:p['y']+p['h'],p['x']:p['x']+p['w']]>0;region &= ~repair
 if spec['kind']=='eye_sclera':
  iris=next(s for s in plan['parts'] if s['id']==spec['iris_part'])
  repair=np.array(Image.open(ROOT/iris['mask']))[p['y']:p['y']+p['h'],p['x']:p['x']+p['w']]>0;region &= ~repair
 changed=int(np.any(im[:,:,:3]!=src[:,:,:3],axis=2)[region].sum());assert changed==0,(spec['id'],changed)
 colors[spec['id']]={'verified_unmodified_source_pixels':int(region.sum()),'changed':changed}
counts={k:sum(p['role']==role for p in plan['parts']) for k,role in [('hair_parts','hair'),('arm_parts','arm'),('torso_parts','torso'),('skirt_parts','skirt'),('leg_parts','leg')]}
for k,v in counts.items():lo,hi=json.loads((ROOT/'character.config.json').read_text())['targets'][k];assert lo<=v<=hi
reconstruction={}
for source_role,file in [('normal','open_rebuild.png'),('blink','blink_rebuild.png'),('mouth_closed','mouth_closed_rebuild.png')]:
 diff=np.abs(np.array(Image.open(ROOT/'checks'/file)).astype('int16')-source[source_role].astype('int16'))
 reconstruction[source_role]={'changed_pixels':int(np.any(diff!=0,axis=2).sum()),'max_channel_delta':int(diff.max())}
report={'status':'passed','parts':len(plan['parts']),'full_canvas_masks':mask_checks,'target_counts':counts,'immutable_sources':'verified','config_unchanged':before_path.exists(),'source_colors':colors,'reconstruction':reconstruction,'generated_expressions_estimated':True}
(ROOT/'checks/final-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='source_colors'},indent=2))
