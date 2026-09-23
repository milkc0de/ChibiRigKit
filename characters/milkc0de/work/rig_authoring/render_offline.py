# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
"""CPU previews using exported production geometry. Not browser/Canvas validation."""
from pathlib import Path
import json,math
import cv2,numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
P=json.loads((ROOT/'rig.project.json').read_text());frames=json.loads((ROOT/'work/rig_authoring/offline_frames.json').read_text())
W,H=P['canvas']['width'],P['canvas']['height'];CHECK=ROOT/'checks'
images={}
for pid,p in P['parts'].items():
 im=np.asarray(Image.open(ROOT/p['file']).convert('RGBA')).astype(np.float32)/255
 im[:,:,:3]*=im[:,:,3:4];images[pid]=im

def warp_mesh(im,origin,src,dst,triangles):
 src=np.asarray(src,np.float32);dst=np.asarray(dst,np.float32)
 if np.max(np.abs(src-dst))<1e-6:return im,origin
 lo=np.floor(dst.min(axis=0)-2).astype(int);hi=np.ceil(dst.max(axis=0)+3).astype(int)
 lo=np.maximum(lo,[-100,-100]);hi=np.minimum(hi,[W+100,H+100]);w,h=(hi-lo).tolist()
 if w<=0 or h<=0:return np.zeros((1,1,4),np.float32),(0,0)
 mapx=np.full((h,w),-1,np.float32);mapy=mapx.copy()
 for tri in triangles:
  a=src[tri]-np.array(origin,np.float32);b=dst[tri]-lo
  if abs((b[1,0]-b[0,0])*(b[2,1]-b[0,1])-(b[1,1]-b[0,1])*(b[2,0]-b[0,0]))<1e-6:continue
  affine=cv2.getAffineTransform(b.astype(np.float32),a.astype(np.float32))
  x0,y0=np.maximum(np.floor(b.min(axis=0)-1).astype(int),[0,0]);x1,y1=np.minimum(np.ceil(b.max(axis=0)+2).astype(int),[w,h])
  if x1<=x0 or y1<=y0:continue
  mask=np.zeros((y1-y0,x1-x0),np.uint8);cv2.fillConvexPoly(mask,np.round((b-[x0,y0])*256).astype('int32'),1,shift=8)
  ys,xs=np.where(mask>0);xs+=x0;ys+=y0
  mapx[ys,xs]=affine[0,0]*xs+affine[0,1]*ys+affine[0,2]
  mapy[ys,xs]=affine[1,0]*xs+affine[1,1]*ys+affine[1,2]
 out=cv2.remap(im,mapx,mapy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 return out,tuple(lo)

def affine(im,origin,m):
 a,b,c,d,tx,ty=m
 if max(abs(a-1),abs(d-1),abs(b),abs(c),abs(tx),abs(ty))<1e-8:return im,origin
 h,w=im.shape[:2];x,y=origin;pts=np.array([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],np.float32)
 dest=pts@np.array([[a,b],[c,d]])+[tx,ty]
 lo=np.floor(dest.min(axis=0)-2).astype(int);hi=np.ceil(dest.max(axis=0)+2).astype(int);size=tuple((hi-lo).tolist())
 M=np.array([[a,c,a*x+c*y+tx-lo[0]],[b,d,b*x+d*y+ty-lo[1]]],np.float32)
 return cv2.warpAffine(im,M,size,flags=cv2.INTER_LINEAR),tuple(lo)

def local_deform(im,p,f):
 origin=(p['x'],p['y']);mesh=p.get('mesh',{});typ=mesh.get('type');I=f['intensity'];t=f['t'];w,h=p['w'],p['h']
 if p['kind'] in ('mouth_closed','drawn_eye_closed'):return im,origin
 if typ=='mouth_open_close' and f['mouth']<1:
  z=1-f['mouth'];sx=1-z*(1-mesh['closed_width_ratio']);sy=.06+.94*f['mouth'];c=mesh['center'];cc=mesh['closed_center'];slope=mesh['closed_slope']*z*sx
  cx=c['x']+(cc['x']-c['x'])*z;cy=c['y']+(cc['y']-c['y'])*z
  return affine(im,origin,[sx,slope,0,sy,cx-sx*c['x'],cy-slope*c['x']-sy*c['y']])
 if not I:return im,origin
 if typ=='soft_strip':
  a=t*2*math.pi/5+p['motion']['phase']*2*math.pi;sy=1+mesh.get('squash_pct',.35)/100*math.sin(a)*I
  return affine(im,origin,[1,0,0,sy,0,(p['y']+h/2)*(1-sy)])
 if typ not in ('soft_body','bend_vertical'):return im,origin
 src=[];dst=[];tris=[];n=mesh.get('slices',8);x,y=origin
 for i in range(n):
  u=(i+.5)/n;a=t*2*math.pi/5+p['motion']['phase']*2*math.pi;amp=mesh.get('amp_px',1)*I
  if typ=='bend_vertical':
   amp*=math.sin(a);dy=math.sin(u*math.pi)*amp;dx=(u-.5)*amp*.18
   q=np.array([[x+w*i/n,y],[x+w*(i+1)/n,y],[x+w*(i+1)/n,y+h],[x+w*i/n,y+h]])
   dest=q+[dx,dy]
  else:
   dx=math.sin(a+u*math.pi)*amp*math.sin(u*math.pi);sx=1+mesh.get('squash_pct',.25)/100*math.sin(a+u*2)*I
   q=np.array([[x,y+h*i/n],[x+w,y+h*i/n],[x+w,y+h*(i+1)/n],[x,y+h*(i+1)/n]])
   dest=q.copy();dest[:,0]=(q[:,0]-(x+w/2))*sx+x+w/2+dx
  src.extend(q);dst.extend(dest);j=4*i;tris.extend([[j,j+1,j+2],[j,j+2,j+3]])
 return warp_mesh(im,origin,src,dst,tris)

def surface(pid,f,cache):
 if pid in cache:return cache[pid]
 p=P['parts'][pid];q=f['parts'][pid];im=images[pid];origin=(p['x'],p['y'])
 if p['kind'] in ('eye_iris','eye_line'):
  owner=P['parts'][p['clip_to']];eye=f['parts'][p['clip_to']]['eye']
  if p['kind']=='eye_iris':origin=(origin[0]+f['gaze'][0]*owner['w']*owner['mesh'].get('gaze_x_ratio',.15),origin[1]+f['gaze'][1]*owner['h']*owner['mesh'].get('gaze_y_ratio',.15))
  if f['eye']<1:im,origin=warp_mesh(im,origin,eye['source'],eye['dest'],eye['triangles'])
 elif 'eye' in q and f['eye']<1:im,origin=warp_mesh(im,origin,q['eye']['source'],q['eye']['dest'],q['eye']['triangles'])
 else:im,origin=local_deform(im,p,f)
 if 'head' in q:
  g=q['head'];im,origin=warp_mesh(im,origin,g['source'],g['dest'],g['triangles'])
 im,origin=affine(im,origin,q['matrix'])
 # Subpixel gaze-only origins are handled by one translation resample.
 if any(abs(v-round(v))>1e-6 for v in origin):
  dx=origin[0]-math.floor(origin[0]);dy=origin[1]-math.floor(origin[1]);im=cv2.warpAffine(im,np.array([[1,0,dx],[0,1,dy]],np.float32),(im.shape[1]+1,im.shape[0]+1));origin=(math.floor(origin[0]),math.floor(origin[1]))
 x,y=map(int,origin);h,w=im.shape[:2];x0=max(0,x);y0=max(0,y);x1=min(W,x+w);y1=min(H,y+h)
 world=np.zeros((H,W,4),np.float32)
 if x1>x0 and y1>y0:world[y0:y1,x0:x1]=im[y0-y:y1-y,x0-x:x1-x]
 if p['kind']=='eye_iris':world*=surface(p['clip_to'],f,cache)[:,:,3:4]
 cache[pid]=world
 return world

def render(f):
 canvas=np.zeros((H,W,4),np.float32);cache={};clip_checks=0
 for pid in P['draw_order']:
  op=f['parts'][pid]['opacity']
  if op<.002:continue
  im=surface(pid,f,cache)*op
  canvas=im+canvas*(1-im[:,:,3:4])
  if P['parts'][pid]['kind']=='eye_iris':
   assert not np.any((im[:,:,3]>1e-4)&(cache[P['parts'][pid]['clip_to']][:,:,3]<1e-6));clip_checks+=1
  # Only sclera surfaces need to remain for later iris clipping.
  if P['parts'][pid]['kind']!='eye_sclera':cache.pop(pid,None)
 rgb=np.divide(canvas[:,:,:3],canvas[:,:,3:4],out=np.zeros_like(canvas[:,:,:3]),where=canvas[:,:,3:4]>0)
 return Image.fromarray(np.round(np.clip(np.concatenate([rgb,canvas[:,:,3:4]],2),0,1)*255).astype('uint8')),clip_checks,int((canvas[:,:,3]<.99).sum())

sheets={'head':Image.new('RGB',(900,1080),'#303038'),'motion':Image.new('RGB',(1280,1080),'#303038'),'random':Image.new('RGB',(1200,720),'#303038')};clip=0;alpha=[]
for i,f in enumerate(frames):
 im,n,holes=render(f);clip+=n;alpha.append(holes)
 if i<9:kind='head';idx=i;cols=3;tw=300;th=360
 elif i<25:kind='motion';idx=i-9;cols=4;tw=320;th=270
 else:kind='random';idx=i-25;cols=4;tw=300;th=360
 im.save(CHECK/(f['name']+'_offline.png'))
 im.thumbnail((tw-12,th-30));sheet=sheets[kind];x=idx%cols*tw+(tw-im.width)//2;y=idx//cols*th+24;sheet.paste(im,(x,y),im)
 ImageDraw.Draw(sheet).text((idx%cols*tw+5,idx//cols*th+5),f['name']+' (offline)',fill='white')
 print(f['name'],'alpha gaps',holes,flush=True)
for k,im in sheets.items():im.save(CHECK/({'head':'head-directions-offline.png','motion':'runtime_sheet_offline.png','random':'random-sway-offline.png'}[k]))
report={'scope':'CPU preview with production JS head/eye geometry and motion matrices; not browser Canvas parity','frames':len(frames),'iris_clip_checks':clip,'alpha_gap_counts':alpha,'browser_validation':'blocked; see geometry-report.json'}
(CHECK/'offline-render-report.json').write_text(json.dumps(report,indent=2)+'\n')
