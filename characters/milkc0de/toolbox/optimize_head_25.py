#!/usr/bin/env python3
"""Migrate this authored character to nine coordinated +/-25 degree layouts.
Reads a preserved baseline. Never rewrites source images or layer geometry.
"""
import copy,json,math,hashlib,base64
from pathlib import Path
import numpy as np
from head_pose import DIRECTIONS
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'work/mesh25-original'

def neutral(count=25):
    return dict(x=0.,y=0.,rotation=0.,scale_x=1.,scale_y=1.,vertices=[[0.,0.] for _ in range(count)])

def entry(config,name,pid,parts):
    data=config['poses'][name]['parts']
    if pid in data:return {**neutral(),**copy.deepcopy(data[pid])}
    owner=parts[pid].get('transform_from')
    return entry(config,name,owner,parts) if owner else neutral()

def resample(config,name,pid,parts):
    # Preserve authored asymmetry and diagonal corrections at the new endpoint.
    u,v=DIRECTIONS[name];c=entry(config,'center',pid,parts)
    if name=='center':return c
    a=entry(config,'left' if u<0 else 'right',pid,parts)
    b=entry(config,'up' if v<0 else 'down',pid,parts)
    d=entry(config,name,pid,parts);x=abs(u)*25/30;y=abs(v)*25/20
    out={}
    for key in c:
        cc,aa,bb,dd=map(np.asarray,[c[key],a[key],b[key],d[key]])
        out[key]=(cc+x*(aa-cc)+y*(bb-cc)+x*y*(dd-aa-bb+cc)).tolist()
    return out

def project_surface(point,n,anatomy,u,v):
    if not u and not v:return list(point)
    center=np.array(anatomy['center']);pivot=np.array([n['pivot']['x'],n['pivot']['y']]);r=math.radians(anatomy['tilt_degrees'])
    R=np.array([[math.cos(r),-math.sin(r)],[math.sin(r),math.cos(r)]])
    local=(np.array(point)-center)@R;neck=(pivot-center)@R;x,y=local
    # Rounded cranium/face on the artwork's tilted anatomical axes.
    # Independent yaw/pitch projections avoid diagonal cross-shear of the face.
    rx,ry=anatomy['radii'];z=anatomy['depth']*math.exp(-.85*((x/rx)**2+(y/ry)**2))
    yaw,pitch=math.radians(u*25),math.radians(v*25)
    upper=1/(1+math.exp(min(40,(y-90)/55)))
    diagonal=abs(u*v)
    sx=math.cos(yaw)-.025*diagonal*upper
    sy=math.cos(pitch)
    delta=np.array([(sx-1)*x+math.sin(yaw)*z,(sy-1)*y+math.sin(pitch)*z])
    # Art-directed silhouette: trim the upper/back cranium on extreme diagonals.
    crown=1/(1+math.exp(min(40,(y+45)/50)))
    delta[0]-=x*(.025*abs(u)+.035*diagonal)*crown
    delta[1]-=(y+40)*(.035*abs(u)+.08*max(v,0)+.04*max(-v,0)+.025*diagonal)*crown
    # Pin the neck locally; let the long hair settle into its original body join.
    pin=1-math.exp(-float(np.sum((local-neck)**2))/(2*75**2))
    tail=1-max(0,min(1,(y-neck[1])/420))**2
    # The old pivot (520,620) lies inside the chin silhouette. Upward pitch
    # must follow a broad attachment below the jaw, not pin that one face vertex.
    up_neck=(np.array(anatomy['up_attachment'])-center)@R
    up_pin=1-math.exp(-float(np.sum((local-up_neck)**2))/(2*75**2))
    delta*=np.array([pin,up_pin if v<0 else pin])*tail
    # Authored jaw lead: the chin follows the turn rather than being left at the neck.
    jaw=(np.array([559.,605.])-center)@R
    jaw_weight=math.exp(-.5*(((x-jaw[0])/125)**2+((y-jaw[1])/75)**2))
    separation=float(np.sum((local-neck)**2));jaw_pin=separation/(separation+24**2)
    delta[0]+=u*26*jaw_weight*jaw_pin*tail
    delta[1]+=min(v,0)*28*jaw_weight*up_pin*tail
    return (np.array(point)+delta@R.T).tolist()

def main():
    old=json.loads((BASE/'rig.project.json').read_text());plan=json.loads((BASE/'rig.plan.json').read_text());p=copy.deepcopy(old);n=p['neck_sway'];parts=p['parts']
    left=parts['eye_left_sclera'];right=parts['eye_right_sclera']
    l=np.array([left['x']+left['w']/2,left['y']+left['h']/2]);r=np.array([right['x']+right['w']/2,right['y']+right['h']/2])
    anatomy={'center':[n['volume']['center']['x'],n['volume']['center']['y']], 'tilt_degrees':float(np.degrees(np.arctan2(*(r-l)[::-1]))),'radii':[285.,300.],'depth':95.,'pitch_gain':.5,'up_attachment':[520.,720.]}
    n.update(yaw_extent=25,pitch_extent=25,layout_mode='coordinated-25-v1',surface=anatomy)
    h=p['head_pose'];h['pose_space']='neck-25-v2'
    for name,(u,v) in DIRECTIONS.items():
        layout={}
        for pid in h['part_ids']:
            if parts[pid].get('transform_from'):continue
            a=resample(old['head_pose'],name,pid,parts);b=resample(old['neck_sway'],name,pid,parts)
            s={key:(np.asarray(a[key])+np.asarray(b[key])-(1 if key.startswith('scale_') else 0)).tolist() for key in a}
            role=parts[pid]['role']
            if name!='center':
                s['rotation']=0 # Yaw/pitch must not add an unintended roll.
                s['vertices']=(np.asarray(s['vertices'])*.45).tolist()
                if role=='eye':
                    # Inset eyes relative to the face, especially on diagonals.
                    side=-1 if pid=='eye_left_sclera' else 1
                    far=bool(u and side==-u)
                    s['x']=u*4-side*(abs(u)*2.5+abs(u*v)*2)+(u*12 if far else 0)
                    s['y']=v*3
                    s['scale_x']=1-.018*abs(u)-.012*abs(u*v)-(.035 if far else 0)
                    s['scale_y']=1+.04*max(v,0)-.01*max(-v,0)-side*u*.008
                    s['vertices']=neutral()['vertices']
                elif role=='face':
                    s['x']=u*2;s['y']=v*1.5;s['scale_x']=1+.012*abs(u);s['scale_y']=1+.02*max(v,0)
                elif role=='mouth':
                    s['x']=u*18;s['y']=-12 if v<0 else 5 if v>0 else 0;s['scale_x']=1-.02*abs(u);s['scale_y']=1+.025*max(-v,0)-.02*max(v,0)
                elif role=='brow':
                    s['x']=u*3;s['y']=v*2;s['scale_x']=1-.025*abs(u);s['scale_y']=1
                elif role in ('hair','ribbon'):
                    s['x']=u*1.5;s['y']=v*.75
                    s['scale_x']=1;s['scale_y']=1
                    s['vertices']=neutral()['vertices']
            layout[pid]=s
        h['poses'][name]={'parts':layout,'status':'authored'}
        # One source for per-part placements; neck holds only the shared surface.
        n['poses'][name]={'parts':{},'status':'authored','vertices':copy.deepcopy(old['neck_sway']['poses']['center']['vertices']) if name=='center' else [project_surface(pt,n,anatomy,u,v) for pt in n['mesh']['points']]}
    # Blend pitch endpoints toward their horizontal counterparts: half the
    # vertical deformation without reducing yaw, including diagonal layouts.
    gain=anatomy['pitch_gain']
    for name,base in [('up_left','left'),('up','center'),('up_right','right'),
                      ('down_left','left'),('down','center'),('down_right','right')]:
        for pid,setting in h['poses'][name]['parts'].items():
            for key,value in setting.items():
                origin=np.asarray(h['poses'][base]['parts'][pid][key])
                setting[key]=(origin+gain*(np.asarray(value)-origin)).tolist()
        origin=np.asarray(n['poses'][base]['vertices'])
        n['poses'][name]['vertices']=(origin+gain*(np.asarray(n['poses'][name]['vertices'])-origin)).tolist()
    plan['head_pose']['poses']=copy.deepcopy(h['poses']);plan['head_pose']['pose_space']=h['pose_space']
    for key in ['poses','yaw_extent','pitch_extent','layout_mode','surface']:plan['neck_sway'][key]=copy.deepcopy(n[key])
    fill_path='assets/generated/neck-underpaint-v1.png'
    if (ROOT/fill_path).exists():
        fill={'file':fill_path,'source_rect':[420,565,290,210],'skin_rect':[480,635,150,100],'head_edge':[[464,592],[606,592]],'body_edge':[[466,666],[580,666]],'body_part':'torso_blouse'}
        plan['neck_fill']=fill
        p['neck_fill']={**fill,'data_url':'data:image/png;base64,'+base64.b64encode((ROOT/fill_path).read_bytes()).decode()}
    (ROOT/'rig.plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'rig.project.json').write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n')
    print('Updated nine layouts and shared head/face surface at +/-25 degrees')
if __name__=='__main__':main()
