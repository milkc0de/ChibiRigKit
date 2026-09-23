#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
import json
from rig_contract import validate_project
from pathlib import Path
from player_output import preview_path
import numpy as np
from PIL import Image,ImageChops,ImageDraw

ROOT=Path(__file__).resolve().parents[1];P=json.loads((ROOT/'rig.project.json').read_text());W,H=P['canvas']['width'],P['canvas']['height'];CHECK=ROOT/'checks';CHECK.mkdir(exist_ok=True)

validate_project(ROOT,P)

def render(state='open'):
    c=Image.new('RGBA',(W,H),(0,0,0,0))
    for name in P['draw_order']:
        p=P['parts'][name];k=p.get('kind','normal');op=p.get('opacity',1)
        if state=='open':
            if k in ('drawn_eye_closed','eye_closed','mouth_closed','mouth_smile'):op=0
        elif state=='mouth_closed':
            if k in ('eye_closed','drawn_eye_closed','mouth_open','mouth_smile'):op=0
        elif state=='base':
            if k!='static' and p.get('role')!='base':op=0
        elif state=='blink':
            if k in ('eye_open','eye_sclera','eye_iris','eye_line'):op=0
            if k in ('drawn_eye_closed','eye_closed'):op=p.get('opacity',1)
            if k in ('mouth_closed','mouth_smile'):op=0
        if op<=.001:continue
        im=Image.open(ROOT/p['file']).convert('RGBA')
        if op<.999:im.putalpha(im.getchannel('A').point(lambda x:int(x*op)))
        c.alpha_composite(im,(int(round(p['x'])),int(round(p['y']))))
    return c

def metric(a,b):
    A=np.array(a.convert('RGBA')).astype(np.float32);B=np.array(b.convert('RGBA')).astype(np.float32);mask=(A[:,:,3]>20)|(B[:,:,3]>20)
    rgb=np.abs(A[:,:,:3]*A[:,:,3:4]/255-B[:,:,:3]*B[:,:,3:4]/255).mean(axis=2);mae=float(rgb[mask].mean()) if mask.any() else 0
    aa=A[:,:,3]>20;bb=B[:,:,3]>20;i=(aa&bb).sum();u=(aa|bb).sum();iou=float(i/max(1,u));return {'rgb_mae':round(mae,3),'alpha_iou':round(iou,5)}

def diff_image(a,b):
    d=ImageChops.difference(a.convert('RGB'),b.convert('RGB'));d=Image.eval(d,lambda x:min(255,x*3));return d.convert('RGBA')

normal=Image.open(ROOT/P['sources']['normal']).convert('RGBA');open_im=render('open');open_im.save(CHECK/'open_rebuild.png');diff_image(normal,open_im).save(CHECK/'open_diff.png');report={'integrity':'passed','scope':'static reconstruction; browser motion checks are separate','open':metric(normal,open_im)}
if 'blink' in P['sources']:
    blink=Image.open(ROOT/P['sources']['blink']).convert('RGBA');blink_im=render('blink');blink_im.save(CHECK/'blink_rebuild.png');diff_image(blink,blink_im).save(CHECK/'blink_diff.png');report['blink']=metric(blink,blink_im)
render('base').save(CHECK/'base_only.png')
if any(p['kind']=='mouth_closed' for p in P['parts'].values()):
    render('mouth_closed').save(CHECK/'mouth_closed_rebuild.png')
# contact sheet
imgs=[('normal',normal),('open',open_im),('open diff',Image.open(CHECK/'open_diff.png'))]
if 'blink' in P['sources']:imgs += [('blink src',Image.open(ROOT/P['sources']['blink'])),('blink rebuild',Image.open(CHECK/'blink_rebuild.png')),('blink diff',Image.open(CHECK/'blink_diff.png'))]
tw=260;th=int(H*tw/W);sheet=Image.new('RGBA',(tw*len(imgs),th+26),(20,20,20,255));d=ImageDraw.Draw(sheet)
for i,(label,im) in enumerate(imgs):
    t=im.convert('RGBA');t.thumbnail((tw,th),Image.Resampling.LANCZOS);sheet.alpha_composite(t,(i*tw+(tw-t.width)//2,26));d.text((i*tw+5,5),label,fill='white')
sheet.save(CHECK/'validation_sheet.png');(CHECK/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

# The same browser assertions can also be opened interactively when headless launch is unavailable.
html=preview_path(ROOT).read_text()
harness="""<style>body{display:flex;flex-direction:column;height:auto;overflow:auto}main,aside{display:none}body>pre{order:-1;padding:16px;white-space:pre-wrap}body>img{max-width:100%}</style><script src="toolbox/head_checks.js"></script><script src="toolbox/neck_checks.js"></script><script src="toolbox/motion_io_checks.js"></script><script src="toolbox/runtime_checks.js"></script><script>
window.rigReady.then(()=>{try{const result=window.runRigChecks();
const image=document.createElement('img');image.src='data:image/png;base64,'+result.png;image.style.width='100%';
delete result.png;
if(result.head?.png){const headImage=document.createElement('img');headImage.src='data:image/png;base64,'+result.head.png;headImage.style.width='100%';document.body.append(headImage);delete result.head.png}
window.rigCheckResult=result;
const report=document.createElement('pre');report.id='rig-check-result';report.textContent=JSON.stringify(result,null,2);
document.body.append(report,image);document.title='PASS: Rig runtime checks';
}catch(error){document.title='FAIL: Rig runtime checks';const report=document.createElement('pre');report.id='rig-check-result';report.textContent=error.stack;document.body.append(report);}});
</script>"""
(ROOT/'runtime-check.html').write_text(html.replace('</body>',harness+'</body>'))
