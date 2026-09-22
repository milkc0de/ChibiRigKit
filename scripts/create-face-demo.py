#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Generate original geometric sample art; no private character assets required."""
import argparse,json,shutil,subprocess,sys
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser();ap.add_argument('--output',default=str(ROOT/'characters/face-turn-demo'));args=ap.parse_args()
out=Path(args.output).resolve()
if out.exists() and any(out.iterdir()):raise SystemExit(f'Output already exists: {out}')
shutil.copytree(ROOT/'template/workspace',out,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'));(out/'work/masks').mkdir(parents=True)
size=(320,400);art={};masks={}
def layer(name,paint):
 im=Image.new('RGBA',size);paint(ImageDraw.Draw(im));art[name]=im;masks[name]=im.getchannel('A');masks[name].save(out/f'work/masks/{name}.png')
layer('body',lambda d:(d.rounded_rectangle((86,225,234,366),28,fill='#7abbd6'),d.polygon([(125,225),(160,252),(195,225)],fill='#d1edf4')))
layer('hair_back',lambda d:d.ellipse((58,33,262,240),fill='#4c3441'))
layer('face',lambda d:d.ellipse((80,66,240,231),fill='#ffdab7'))
layer('hair_front',lambda d:(d.pieslice((60,23,260,169),180,355,fill='#4c3441'),d.polygon([(74,100),(109,70),(148,100),(133,48)],fill='#4c3441'),d.polygon([(146,63),(166,104),(209,72),(240,110),(243,49)],fill='#4c3441')))
for side,x in [('left',104),('right',180)]:
 layer(f'{side}_sclera',lambda d,x=x:d.ellipse((x,126,x+36,164),fill='#fff9f0'))
 layer(f'{side}_iris',lambda d,x=x:(d.ellipse((x+11,131,x+28,160),fill='#604775'),d.ellipse((x+15,139,x+25,158),fill='#282639'),d.ellipse((x+12,134,x+18,140),fill='white')))
 layer(f'{side}_line',lambda d,x=x:d.arc((x-1,122,x+39,165),190,345,fill='#4c3441',width=3))
 layer(f'{side}_closed',lambda d,x=x:d.arc((x-1,136,x+39,157),10,170,fill='#4c3441',width=3))
 layer(f'{side}_blush',lambda d,x=x:d.ellipse((x-6,174,x+24,187),fill='#f399aa'))
layer('mouth_open',lambda d:(d.ellipse((147,191,173,210),fill='#8e4157'),d.ellipse((151,200,169,209),fill='#ef8794')))
layer('mouth_closed',lambda d:d.arc((147,188,173,203),10,170,fill='#8e4157',width=2))
order=['body','hair_back','face','hair_front','left_blush','right_blush','mouth_open','left_sclera','left_iris','left_line','right_sclera','right_iris','right_line']
def compose(names):
 im=Image.new('RGBA',size)
 for name in names:im=Image.alpha_composite(im,art[name])
 return im
normal=compose(order);flat=compose(['body','face'])
blink=compose([n for n in order if not any(n.endswith('_'+s) for s in ['sclera','iris','line'])]+['left_closed','right_closed'])
closed=compose([n for n in order if n!='mouth_open']+['mouth_closed'])
for role,im in [('normal',normal),('flat',flat),('blink',blink),('mouth_closed',closed)]:im.save(out/f'input/{role}.png')
cfg=json.loads((out/'character.config.json').read_text());cfg['name']='顔のランダムな動き・9方向デモ';cfg['inputs']={r:f'{r}.png' for r in ['normal','flat','blink','mouth_closed']};(out/'character.config.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
subprocess.run([sys.executable,str(out/'toolbox/normalize_inputs.py')],check=True,stdout=subprocess.DEVNULL)
# These generated layers already share exact coordinates; no feature matching needed.
for role in cfg['inputs']:shutil.copy2(out/f'input/{role}.png',out/f'work/aligned/{role}.png')
sys.path.insert(0,str(out/'toolbox'));from rig_contract import snapshot
(out/'work/source_hashes.json').write_text(json.dumps(snapshot(out),indent=2))
parts=[]
for name in order+['mouth_closed','left_closed','right_closed']:
 role='hair' if name.startswith('hair') else ('face' if name=='face' or name.endswith('blush') else ('torso' if name=='body' else ('mouth' if name.startswith('mouth') else 'eye')))
 kind='normal' if name=='body' else ('blush' if name.endswith('blush') else ('normal' if name in ['face','hair_back','hair_front'] else ('drawn_eye_closed' if name in ['left_closed','right_closed'] else ('eye_'+name.split('_')[-1] if role=='eye' else name))))
 spec={'id':name,'source':'flat' if name=='face' else ('blink' if kind=='drawn_eye_closed' else ('mouth_closed' if name=='mouth_closed' else 'normal')),'mask':f'work/masks/{name}.png','kind':kind,'role':role,'head':name!='body'}
 if name=='face':spec['mesh']={'type':'face_grid'}
 if kind=='eye_sclera':spec.update(iris_part=name.replace('sclera','iris'),closed_part=name.replace('sclera','closed'),mesh={'type':'blink_eye_radial'})
 if kind in ['eye_iris','eye_line']:spec['clip_to']=name.rsplit('_',1)[0]+'_sclera'
 if name=='mouth_open':spec.update(closed_part='mouth_closed',mesh={'type':'mouth_open_close'})
 parts.append(spec)
plan={'name':cfg['name'],'parts':parts,'draw_order':[p['id'] for p in parts],'head_pose':{'columns':4,'rows':4}}
(out/'rig.plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
for script in ['build_project.py','validate_character.py']:subprocess.run([sys.executable,str(out/'toolbox'/script)],check=True)
print(out)
