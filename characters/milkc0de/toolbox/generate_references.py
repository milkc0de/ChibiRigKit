#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Build missing reference images from one image and a vision-authored face plan.
The original is immutable. All new artwork is labelled as estimated reference art.
"""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageChops
from jsonschema import Draft202012Validator
from rig_contract import local_path,digest,verify_sources
ROOT=Path(__file__).resolve().parents[1]


def generate(root):
    cfg=json.loads((root/'character.config.json').read_text())
    wanted=[role for role in ('flat','blink','mouth_closed') if not cfg['inputs'].get(role)]
    if not wanted:return {'generated':[], 'reason':'All references were supplied'}
    verify_sources(root)
    plan_path=root/'reference.plan.json';plan=json.loads(plan_path.read_text())
    Draft202012Validator(json.loads((root/'reference.plan.schema.json').read_text())).validate(plan)
    original=Image.open(root/'work/aligned/normal.png').convert('RGBA');arr=np.array(original);width,height=original.size
    output=root/'work/generated_references';(output/'masks').mkdir(parents=True,exist_ok=True)
    features=list(plan.get('eyes',[]))+([plan['mouth']] if plan.get('mouth') else [])
    ids=[f['id'] for f in features]
    if len(ids)!=len(set(ids)):raise ValueError('Reference feature IDs must be unique')
    masks={};margins={};asset_hashes={};emitted_masks={}
    def load_mask(value):
        path=local_path(root,value);mask=Image.open(path).convert('L')
        if mask.size!=original.size or not mask.getbbox():raise ValueError(f'{value}: empty or mismatched reference mask')
        asset_hashes[value]=digest(path)
        return np.array(mask)>0
    for f in features:
        mask=load_mask(f['mask']);masks[f['id']]=mask
        margin=f.get('margin',2);region=cv2.dilate(mask.astype(np.uint8),np.ones((margin*2+1,margin*2+1),np.uint8))>0
        region&=arr[:,:,3]>0
        if not region.any():raise ValueError(f'{f["id"]}: feature lies outside the character')
        if region.sum()>width*height*.4:raise ValueError(f'{f["id"]}: facial feature mask is too broad')
        margins[f['id']]=region
        for x,y in f['closed_curve']:
            if not np.isfinite([x,y]).all() or not 0<=x<width or not 0<=y<height or not region[min(height-1,round(y)),min(width-1,round(x))]:
                raise ValueError(f'{f["id"]}: closed curve leaves its edit region')
    extra=[load_mask(value)&(arr[:,:,3]>0) for value in plan.get('flat_extra_masks',[])]
    def erase(selected,extras=()):
        result=arr.copy();region=np.zeros((height,width),bool)
        for f in selected:region|=margins[f['id']]
        for mask in extras:region|=mask
        if region.sum()>width*height*.6:raise ValueError('Combined face edits cover too much of the image')
        if region.any():
            prediction=cv2.inpaint(arr[:,:,:3],region.astype(np.uint8)*255,plan.get('inpaint_radius',3),cv2.INPAINT_TELEA)
            result[region,:3]=prediction[region]
            for f in selected:
                if 'skin_color' in f:result[margins[f['id']],:3]=f['skin_color']
        return Image.fromarray(result),region
    def draw_closed(image,selected):
        for f in selected:
            if f.get('already_closed',False):
                # This branch is handled by keeping the entire source unchanged for that feature.
                continue
            color=f.get('line_color')
            if color is None:
                colors=arr[masks[f['id']] & (arr[:,:,3]>128),:3]
                if not len(colors):raise ValueError('Feature contains no opaque source pixels')
                luminance=colors.mean(axis=1);dark=colors[luminance<=np.percentile(luminance,20)]
                color=np.median(dark,axis=0).astype(np.uint8).tolist()
            scale=4;mask=Image.new('L',(width*scale,height*scale));pen=ImageDraw.Draw(mask)
            curves=[f['closed_curve']]+f.get('lashes',[])
            for curve in curves:
                points=[(round(x*scale),round(y*scale)) for x,y in curve]
                pen.line(points,fill=255,width=max(1,round(f['stroke_width']*scale)),joint='curve')
            mask=mask.resize((width,height),Image.Resampling.LANCZOS)
            mask=ImageChops.multiply(mask,Image.fromarray(margins[f['id']].astype(np.uint8)*255))
            paint=Image.new('RGBA',original.size,tuple(color)+(255,));image=Image.composite(paint,image,mask)
            mask_file=output/'masks'/f'{f["id"]}_closed.png';mask.save(mask_file)
            emitted_masks[f'{f["id"]}_closed']=str(mask_file.relative_to(root))
        image.putalpha(original.getchannel('A'))
        return image
    generated={};regions={}
    if 'flat' in wanted:generated['flat'],regions['flat']=erase(features,extra)
    for role,selected in [('blink',plan.get('eyes',[])),('mouth_closed',[plan['mouth']] if plan.get('mouth') else [])]:
        if role not in wanted:continue
        for f in selected:
            if f.get('already_closed',False):emitted_masks[f'{f["id"]}_closed']=f['mask']
        active=[f for f in selected if not f.get('already_closed',False)]
        image,region=erase(active);generated[role]=draw_closed(image,active);regions[role]=region
    manifest={'version':1,'method':'vision masks + local inpainting + authored closed curves','estimated':True,
              'source_sha256':digest(local_path(root,'input/'+cfg['inputs']['normal'])),
              'plan_sha256':digest(plan_path),'mask_sha256':asset_hashes,'roles':{},'masks':{}}
    for role,image in generated.items():
        file=output/f'{role}.png';image.save(file);pixels=np.array(image);changed=np.any(pixels!=arr,axis=2)
        if np.any(changed & ~regions[role]):raise ValueError(f'{role}: generated pixels escaped approved face masks')
        manifest['roles'][role]={'file':str(file.relative_to(root)),'sha256':digest(file),'changed_pixels':int(changed.sum()),'edited_region_pixels':int(regions[role].sum())}
    manifest['masks']=emitted_masks
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    sheet=Image.new('RGBA',(280*(len(generated)+1),round(height*280/width)+28),'#25252a');pen=ImageDraw.Draw(sheet)
    for i,(role,im) in enumerate([('normal',original)]+list(generated.items())):
        thumbnail=im.copy();thumbnail.thumbnail((280,sheet.height-28),Image.Resampling.LANCZOS);sheet.alpha_composite(thumbnail,(i*280,28));pen.text((i*280+6,6),role,fill='white')
    (root/'checks').mkdir(exist_ok=True);sheet.save(root/'checks/generated_references.png')
    (root/'checks/generated_references.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return manifest

if __name__=='__main__':print(json.dumps(generate(ROOT),ensure_ascii=False,indent=2))
