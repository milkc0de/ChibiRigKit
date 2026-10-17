#!/usr/bin/env python3
"""Offline layout preview from geometry evaluated by the actual JS functions.
Does not test browser canvas, blink, recording or live playback.
"""
import json, argparse
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]

def warp(image, data, size, scale=.5):
    src=np.asarray(data['src']);dst=np.asarray(data['dest'])*scale
    pixels=np.asarray(image.convert('RGBA'),dtype=float)/255
    pixels[:,:,:3]*=pixels[:,:,3,None]
    out=np.zeros((size[1],size[0],4),dtype=np.float32)
    for ids in data['triangles']:
        a,b,c=dst[ids];pa,pb,pc=src[ids]
        left,top=np.maximum(0,np.floor(np.min([a,b,c],axis=0)).astype(int));right,bottom=np.minimum(size,np.ceil(np.max([a,b,c],axis=0)).astype(int)+1)
        if left>=right or top>=bottom:continue
        yy,xx=np.mgrid[top:bottom,left:right];q=np.stack([xx+.5-a[0],yy+.5-a[1]],axis=-1)
        mat=np.stack([b-a,c-a],axis=1)
        if abs(np.linalg.det(mat))<1e-8:continue
        uv=q@np.linalg.inv(mat).T;u,v=uv[:,:,0],uv[:,:,1]
        inside=(u>=-1e-6)&(v>=-1e-6)&(u+v<=1+1e-6)
        xy=pa+u[:,:,None]*(pb-pa)+v[:,:,None]*(pc-pa)-.5
        x=np.clip(xy[:,:,0],0,image.width-1);y=np.clip(xy[:,:,1],0,image.height-1)
        x0=x.astype(int);y0=y.astype(int);x1=np.minimum(x0+1,image.width-1);y1=np.minimum(y0+1,image.height-1)
        fx=(x-x0)[:,:,None];fy=(y-y0)[:,:,None]
        rgba=(pixels[y0,x0]*(1-fx)+pixels[y0,x1]*fx)*(1-fy)+(pixels[y1,x0]*(1-fx)+pixels[y1,x1]*fx)*fy
        patch=out[top:bottom,left:right];patch[inside]=rgba[inside]
    alpha=out[:,:,3,None];out[:,:,:3]=np.divide(out[:,:,:3],alpha,out=np.zeros_like(out[:,:,:3]),where=alpha>0)
    return Image.fromarray(np.uint8(np.clip(out*255,0,255)))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('geometry');ap.add_argument('output');ap.add_argument('--project',default=str(ROOT/'rig.project.json'));ap.add_argument('--scale',type=float,default=.5);args=ap.parse_args()
    if not .2<=args.scale<=1:ap.error('--scale must be 0.2..1')
    project=json.loads(Path(args.project).read_text());geometry=json.loads(Path(args.geometry).read_text());scale=args.scale
    metrics={}
    size=(int(project['canvas']['width']*scale),int(project['canvas']['height']*scale));frames={}
    layers={k:Image.open(ROOT/p['file']).convert('RGBA') for k,p in project['parts'].items()}
    def bounds(mask):
        yy,xx=np.where(mask)
        if not len(xx):return None
        return {'x':float(xx.min()/scale),'y':float(yy.min()/scale),'width':float((xx.max()-xx.min()+1)/scale),'height':float((yy.max()-yy.min()+1)/scale),'area':int(mask.sum())}
    for name,pose in geometry.items():
        canvas=Image.new('RGBA',size,(235,229,219,255));warped={}
        for pid in project['draw_order']:
            p=project['parts'][pid]
            if pid==project['neck_sway']['anchor_part'] and pose.get('neckFill'):
                im=Image.open(ROOT/project['neck_fill']['file']).convert('RGBA')
                canvas.alpha_composite(warp(im,pose['neckFill'],size,scale))
            if p['name']=='background' or p['role']=='background':continue
            if p['kind'] in ['drawn_eye_closed','eye_closed','mouth_closed','mouth_smile']:continue
            layer=warp(layers[pid],pose['parts'][pid],size,scale)
            if p['kind']=='eye_iris':
                arr=np.array(layer);mask=np.asarray(warped[p['clip_to']])[:,:,3]/255;arr[:,:,3]=np.uint8(arr[:,:,3]*mask);layer=Image.fromarray(arr)
            warped[pid]=layer;canvas.alpha_composite(layer)
        frames[name]=canvas
        face=np.asarray(warped['face_skin'])[:,:,3]>100
        metrics[name]={}
        for pid in ['eye_left_sclera','eye_right_sclera']:
            eye=np.asarray(warped[pid])[:,:,3]>128
            margins=[]
            for row in range(eye.shape[0]):
                ex=np.flatnonzero(eye[row]);fx=np.flatnonzero(face[row])
                if len(ex)>2 and len(fx)>2:margins.append((ex.min()-fx.min()) if 'left' in pid else (fx.max()-ex.max()))
            metrics[name][pid]={'outer_margin_source_px':float(min(margins)/scale) if margins else None,'area':int(eye.sum()),'outside_face':int((eye & ~face).sum()),'outside_fraction':float((eye & ~face).sum()/max(1,eye.sum())),'bounds_source_px':bounds(eye)}
        head=np.zeros_like(face)
        for pid in ['face_skin','hair_cap','hair_side_left','hair_side_right','hair_bangs','hair_cowlick','ribbon_head']:
            if pid in warped:head|=np.asarray(warped[pid])[:,:,3]>128
        head[int(635*scale):]=False
        metrics[name]['head']={'bounds_source_px':bounds(head)}
        metrics[name]['face']={'bounds_source_px':bounds(face)}
        metrics[name]['mouth']={'bounds_source_px':bounds(np.asarray(warped['mouth_open'])[:,:,3]>128)}
    for name,items in metrics.items():
        for pid,item in items.items():
            b=item['bounds_source_px'];center=metrics['center'][pid]['bounds_source_px']
            item['relative_to_center']={key:b[key]/center[key] for key in ['width','height','area']}
    # Crop around the head so eye/face/hair layout is legible.
    crop=(int(110*scale),0,int(1040*scale),int(770*scale));tw,th=crop[2]-crop[0],crop[3]
    sheet=Image.new('RGB',(tw*3,th*3+40*3+45),(22,24,29));draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17)
    draw.text((14,12),'9-direction layout / offline geometry preview',fill='white',font=font)
    for i,name in enumerate(['up_left','up','up_right','left','center','right','down_left','down','down_right']):
        x=i%3*tw;y=i//3*(th+40)+45;sheet.paste(frames[name].crop(crop).convert('RGB'),(x,y))
        p=geometry[name];draw.text((x+10,y+th+10),f"{name}   yaw {p['yaw']:+.0f} / pitch {p['pitch']:+.0f}",fill='white',font=font)
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);sheet.save(out)
    out.with_suffix('.json').write_text(json.dumps(metrics,indent=2))
    for name,frame in frames.items():frame.save(out.parent/(out.stem+'-'+name+'.png'))
    print(out)
if __name__=='__main__':main()
