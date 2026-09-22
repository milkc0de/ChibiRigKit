#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
from __future__ import annotations
import json, math
from rig_contract import snapshot, digest, local_path
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
CFG=json.loads((ROOT/'character.config.json').read_text())
IN=ROOT/'input'; OUT=ROOT/'work'/'aligned'; OUT.mkdir(parents=True,exist_ok=True)

def alpha_bbox(im:Image.Image):
    bb=im.convert('RGBA').getchannel('A').getbbox()
    return bb or (0,0,im.width,im.height)

def similarity_by_bbox(src:Image.Image,dst:Image.Image):
    sb=alpha_bbox(src); db=alpha_bbox(dst)
    sx=(db[2]-db[0])/max(1,(sb[2]-sb[0])); sy=(db[3]-db[1])/max(1,(sb[3]-sb[1]))
    # Preserve independent x/y scaling: generated reference images can differ slightly by aspect.
    tx=db[0]-sb[0]*sx; ty=db[1]-sb[1]*sy
    return np.array([[sx,0,tx],[0,sy,ty]],np.float32)

def refine_affine(src:Image.Image,dst:Image.Image,initial:np.ndarray):
    # First warp by bbox, then use SIFT to refine only when enough stable features survive outfit/expression changes.
    w,h=dst.size
    s=np.array(src.convert('RGB'))
    warped=cv2.warpAffine(s,initial,(w,h),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0)
    d=np.array(dst.convert('RGB'))
    gray1=cv2.cvtColor(warped,cv2.COLOR_RGB2GRAY); gray2=cv2.cvtColor(d,cv2.COLOR_RGB2GRAY)
    try:
        sift=cv2.SIFT_create(nfeatures=1600)
        k1,des1=sift.detectAndCompute(gray1,None); k2,des2=sift.detectAndCompute(gray2,None)
        if des1 is None or des2 is None:return initial,0,None
        pairs=cv2.BFMatcher().knnMatch(des1,des2,k=2)
        good=[pair[0] for pair in pairs if len(pair)==2 and pair[0].distance<.68*pair[1].distance]
        if len(good)<18:return initial,len(good),None
        a=np.float32([k1[m.queryIdx].pt for m in good]); b=np.float32([k2[m.trainIdx].pt for m in good])
        delta,inliers=cv2.estimateAffinePartial2D(a,b,method=cv2.RANSAC,ransacReprojThreshold=2.5,maxIters=3000,confidence=.995)
        if delta is None:return initial,len(good),None
        # Compose delta * initial in homogeneous coords.
        I=np.vstack([initial,[0,0,1]]); D=np.vstack([delta,[0,0,1]]); M=(D@I)[:2]
        # sanity
        scale=math.sqrt(M[0,0]**2+M[1,0]**2)
        if not .65<=math.sqrt(delta[0,0]**2+delta[1,0]**2)<=1.5:return initial,len(good),None
        return M.astype(np.float32),int(inliers.sum()) if inliers is not None else 0,float(np.median(np.linalg.norm(cv2.transform(a[None],delta)[0]-b,axis=1)))
    except Exception:
        return initial,0,None

def warp(src:Image.Image,M:np.ndarray,size):
    arr=np.array(src.convert('RGBA'))
    out=cv2.warpAffine(arr,M,size,flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_CONSTANT,borderValue=(0,0,0,0))
    return Image.fromarray(out,'RGBA')

roles=CFG['inputs']
if not roles.get('normal'):raise ValueError('normal input is required')
canonical_role='normal'  # Preserve the complete art; flat may omit hair/limbs.
canonical=Image.open(IN/roles[canonical_role]).convert('RGBA')
W,H=canonical.size
cached={};manifest_path=ROOT/'work/generated_references/manifest.json'
if manifest_path.exists():
    try:
        manifest=json.loads(manifest_path.read_text())
        valid=(manifest.get('source_sha256')==digest(IN/roles['normal']) and
               manifest.get('plan_sha256')==digest(ROOT/'reference.plan.json') and
               all(digest(local_path(ROOT,p))==value for p,value in manifest.get('mask_sha256',{}).items()))
        if valid:
            for role,entry in manifest['roles'].items():
                file=local_path(ROOT,entry['file'])
                if role in ('flat','blink','mouth_closed') and digest(file)==entry['sha256'] and Image.open(file).size==(W,H):cached[role]=file
    except (OSError,ValueError,KeyError):pass
for role in ('flat','blink','mouth_closed'):
    if not roles.get(role) and role not in cached and (OUT/f'{role}.png').exists():(OUT/f'{role}.png').unlink()
report={'canonical_role':canonical_role,'canvas':{'width':W,'height':H},'roles':{}}
for role,filename in roles.items():
    generated=not filename and role in cached
    if not filename and not generated:continue
    input_path=cached[role] if generated else local_path(ROOT,'input/'+filename)
    src=Image.open(input_path).convert('RGBA')
    if role==canonical_role or generated:
        aligned=src.copy(); M=np.array([[1,0,0],[0,1,0]],np.float32); matches=0; err=0
    else:
        initial=similarity_by_bbox(src,canonical)
        M,matches,err=refine_affine(src,canonical,initial)
        aligned=warp(src,M,(W,H))
    path=OUT/f'{role}.png'; aligned.save(path)
    report['roles'][role]={'input':str(input_path.relative_to(ROOT)),'generated':generated,'aligned':str(path.relative_to(ROOT)),'matrix':M.tolist(),'feature_inliers':matches,'median_error':err}

# contact sheet
items=[]
for role in roles:
    p=OUT/f'{role}.png'
    if p.exists():items.append((role,Image.open(p).convert('RGBA')))
thumb_w=280; thumb_h=int(H*thumb_w/W)
sheet=Image.new('RGBA',(thumb_w*len(items),thumb_h+28),(25,25,25,255))
d=ImageDraw.Draw(sheet)
for i,(role,im) in enumerate(items):
    t=im.copy();t.thumbnail((thumb_w,thumb_h),Image.Resampling.LANCZOS)
    sheet.alpha_composite(t,(i*thumb_w+(thumb_w-t.width)//2,28))
    d.text((i*thumb_w+8,7),role,fill='white')
(ROOT/'work'/'source_montage.png').parent.mkdir(exist_ok=True)
sheet.save(ROOT/'work'/'source_montage.png')
(ROOT/'work'/'registration.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))

(ROOT/'work'/'source_hashes.json').write_text(json.dumps(snapshot(ROOT),indent=2)+'\n')
