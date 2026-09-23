# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
"""Nine authored head directions and split-eye preparation (canvas coordinates)."""
import copy
import hashlib
import json
import numpy as np
from PIL import Image, ImageChops

DIRECTIONS = {'center':(0,0),'left':(-1,0),'right':(1,0),'up':(0,-1),'down':(0,1),
              'up_left':(-1,-1),'up_right':(1,-1),'down_left':(-1,1),'down_right':(1,1)}
HEAD_ROLES = {'face','eye','mouth','brow'}


def fill_sclera(root, spec, specs, source, mask):
    iris = specs[spec['iris_part']]
    iris_mask = Image.open(root/iris['mask']).convert('L')
    if iris_mask.size != source.size:raise ValueError('Iris mask canvas mismatch')
    region = np.asarray(mask)>0
    pupil = np.asarray(iris_mask)>0
    if np.any(pupil & ~region):raise ValueError(f'{spec["id"]}: iris mask must fit inside sclera mask')
    arr = np.array(source)
    color = spec.get('sclera_fill')
    if color is None:
        visible = arr[region & ~pupil & (arr[:,:,3]>240),:3]
        bright = visible[visible.mean(axis=1)>180]
        if len(bright)<4:raise ValueError(f'{spec["id"]}: no reliable white sample; specify sclera_fill RGB')
        color = np.median(bright,axis=0).astype(np.uint8).tolist()
    # Derived white underpaint only under the pupil: immutable source stays intact.
    arr[pupil,:3] = color
    arr[pupil,3] = 255
    return Image.fromarray(arr), color


def build_head_pose(plan, parts, canvas):
    supplied = copy.deepcopy(plan.get('head_pose', {}))
    cols, rows = supplied.get('columns',4), supplied.get('rows',4)
    if not isinstance(cols,int) or not isinstance(rows,int) or not 1<=cols<=8 or not 1<=rows<=8:
        raise ValueError('head_pose columns/rows must be integers in 1..8')
    members = [pid for pid,p in parts.items() if p.get('head',p['role'] in HEAD_ROLES or p['kind']=='blush')]
    if not members:return None
    geometry={pid:{'x':p['x'],'y':p['y'],'w':p['w'],'h':p['h'],'sha256':p['sha256']} for pid,p in parts.items() if pid in members}
    signature=hashlib.sha256(json.dumps([canvas,cols,rows,geometry],sort_keys=True).encode()).hexdigest()
    if supplied.get('layout_signature') and supplied['layout_signature']!=signature:
        raise ValueError('Head poses belong to a different part layout; remove stale poses or restore matching assets')
    for pid in members:
        p=parts[pid]
        # Padding contains the animated part before pose deformation.
        p['head_bounds']={'x':p['x']-16,'y':p['y']-16,'w':p['w']+32,'h':p['h']+32}
    poses=supplied.get('poses') or suggest_poses(parts,members,cols,rows)
    if set(poses)-set(DIRECTIONS):raise ValueError('Unknown head direction')
    count=(cols+1)*(rows+1)
    for name in DIRECTIONS:
        pose=poses.setdefault(name,{'parts':{}})
        if set(pose.get('parts',{}))-set(members):raise ValueError(f'{name}: unknown head part')
        for pid,setting in pose.get('parts',{}).items():
            validate_setting(setting,count)
            if not valid_mesh(parts[pid]['head_bounds'],setting,cols,rows):raise ValueError(f'{name}/{pid}: folded head mesh')
    result={'version':1,'columns':cols,'rows':rows,'part_ids':members,'layout_signature':signature,'poses':poses}
    if supplied.get('pose_space'):result['pose_space']=supplied['pose_space']
    # Check blends too. Runtime additionally rejects any folded mesh at the exact live angle.
    for y in np.linspace(-1,1,9):
        for x in np.linspace(-1,1,9):
            weights=pose_weights(x,y)
            for pid in members:
                offsets=np.zeros((count,2))
                for name,weight in weights.items():
                    offsets+=np.asarray(poses[name]['parts'].get(pid,{}).get('vertices',[[0,0]]*count))*weight
                if not valid_mesh(parts[pid]['head_bounds'],{'vertices':offsets.tolist()},cols,rows):
                    raise ValueError(f'{pid}: head poses fold between saved directions')
    return result


def validate_setting(setting,count):
    if set(setting)-{'x','y','rotation','scale_x','scale_y','vertices'}:raise ValueError('Unknown head pose property')
    for key,value in setting.items():
        if key=='vertices':
            values=np.asarray(value,dtype=float)
            if values.shape!=(count,2) or not np.isfinite(values).all():raise ValueError('Head vertices have wrong shape or nonfinite numbers')
        elif not isinstance(value,(float,int)) or not np.isfinite(value):raise ValueError('Head pose must contain finite numbers')
    for key in ('scale_x','scale_y'):
        if not .3<=setting.get(key,1)<=2:raise ValueError('Head pose scale must be 0.3..2')
    if abs(setting.get('rotation',0))>45:raise ValueError('Head pose rotation must be -45..45 degrees')


def pose_weights(x,y):
    x=float(np.clip(x,-1,1));y=float(np.clip(y,-1,1))
    return {name:max(0,1-abs(x-dx))*max(0,1-abs(y-dy)) for name,(dx,dy) in DIRECTIONS.items()}


def valid_mesh(bounds,setting,cols,rows):
    points=np.array([[bounds['x']+bounds['w']*c/cols,bounds['y']+bounds['h']*r/rows]
                     for r in range(rows+1) for c in range(cols+1)],dtype=float)
    points+=np.asarray(setting.get('vertices',np.zeros_like(points)),dtype=float)
    for r in range(rows):
        for c in range(cols):
            a=r*(cols+1)+c;b=a+1;d=a+cols+1;e=d+1
            for i,j,k in ((a,b,e),(a,e,d)):
                u=points[j]-points[i];v=points[k]-points[i]
                if u[0]*v[1]-u[1]*v[0]<=.0001:return False
    return True


def suggest_poses(parts,members,cols,rows):
    faces=[parts[pid] for pid in members if parts[pid]['role']=='face' and parts[pid]['kind']!='blush']
    reference=max(faces,key=lambda p:p['w']*p['h']) if faces else max((parts[pid] for pid in members),key=lambda p:p['w']*p['h'])
    width,height=reference['w'],reference['h'];center=reference['x']+width/2
    result={}
    for name,(yaw,pitch) in DIRECTIONS.items():
        entries={}
        for pid in members:
            p=parts[pid]
            if p.get('transform_from'):continue
            role=p['role'];depth=.4 if role=='hair' else (.65 if role=='face' else 1)
            setting={'x':yaw*width*.06*depth,'y':pitch*height*.035*depth,'rotation':0,
                     'scale_x':1-abs(yaw)*.025,'scale_y':1-abs(pitch)*.025,
                     'vertices':[[0,0] for _ in range((cols+1)*(rows+1))]}
            if role=='eye':setting['scale_x']+=yaw*(1 if p['x']+p['w']/2>center else -1)*.06
            if p.get('mesh',{}).get('type')=='face_grid':
                for r in range(rows+1):
                    for c in range(cols+1):
                        u=c/cols;v=r/rows
                        setting['vertices'][r*(cols+1)+c]=[yaw*width*.07*np.sin(u*np.pi)*np.sin(v*np.pi),pitch*height*.04*np.sin(u*np.pi)*np.sin(v*np.pi)]
            entries[pid]=setting
        result[name]={'parts':entries,'status':'suggested'}
    return result


def build_neck_sway(plan, parts, canvas):
    """One shared neck pivot, independent of the nine facial pose meshes."""
    members = [pid for pid,p in parts.items() if p.get('head',p['role'] in HEAD_ROLES | {'hair'} or p['kind']=='blush')]
    faces = [pid for pid in members if parts[pid]['role']=='face' and parts[pid]['kind']!='blush']
    if not faces:return None
    anchor = max(faces,key=lambda pid:parts[pid]['w']*parts[pid]['h'])
    face = parts[anchor]
    pivot = copy.deepcopy(plan.get('neck_sway',{}).get('pivot',{'x':face['x']+face['w']/2,'y':face['y']+face['h']}))
    if not isinstance(pivot,dict) or set(pivot)!={'x','y'}:raise ValueError('neck_sway pivot must contain x and y')
    for axis,extent in [('x','width'),('y','height')]:
        value=pivot[axis]
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not np.isfinite(value) or not 0<=value<=canvas[extent]:
            raise ValueError('neck_sway pivot must be finite and inside the canvas')
    poses=copy.deepcopy(plan.get('neck_sway',{}).get('poses')) or suggest_neck_poses(parts,members)
    if set(poses)!=set(DIRECTIONS):raise ValueError('neck_sway requires nine yaw/pitch poses')
    for pose in poses.values():
        if set(pose.get('parts',{}))-set(members):raise ValueError('Unknown neck pose part')
        for setting in pose.get('parts',{}).values():validate_setting(setting,25)
    volume={'center':{'x':face['x']+face['w']/2,'y':face['y']+face['h']/2},'radius_x':face['w']*.65,'radius_y':face['h']*.75,'depth':min(face['w'],face['h'])*.28}
    # One shared lattice for face, scalp, hair, eyes, mouth and head accessories.
    # Include a row and column through the neck so its attachment is an exact vertex.
    left=max(0,min(parts[pid]['x'] for pid in members)-64);right=min(canvas['width'],max(parts[pid]['x']+parts[pid]['w'] for pid in members)+64)
    top=max(0,min(parts[pid]['y'] for pid in members)-64);bottom=min(canvas['height'],max(parts[pid]['y']+parts[pid]['h'] for pid in members)+64)
    xs=sorted(set(np.linspace(left,right,17).tolist()+[float(pivot['x'])]))
    ys=sorted(set(np.linspace(top,bottom,20).tolist()+[float(pivot['y'])]))
    points=[[x,y] for y in ys for x in xs];columns=len(xs)-1;triangles=[]
    for r in range(len(ys)-1):
        for c in range(columns):
            a=r*len(xs)+c;b=a+1;d=a+len(xs);e=d+1;triangles.extend([[a,b,e],[a,e,d]])
    mesh_signature=hashlib.sha256(json.dumps(points,separators=(',',':')).encode()).hexdigest()
    saved_signature=plan.get('neck_sway',{}).get('mesh_signature')
    if saved_signature and saved_signature!=mesh_signature:raise ValueError('Neck reference mesh layout changed; re-layout its nine poses before rebuilding')
    extent=plan.get('neck_sway',{});legacy=bool(extent.get('poses')) and 'yaw_extent' not in extent and 'pitch_extent' not in extent
    yaw_extent=extent.get('yaw_extent',30 if legacy else 25);pitch_extent=extent.get('pitch_extent',20 if legacy else 25)
    pitch_gain=extent.get('pitch_gain',.5)
    if not isinstance(pitch_gain,(float,int)) or not 0<pitch_gain<=1:raise ValueError('Neck pitch gain must be in (0,1]')
    if not all(isinstance(v,(int,float)) and not isinstance(v,bool) and 0<v<=45 for v in [yaw_extent,pitch_extent]):raise ValueError('Neck extents must be in (0,45] degrees')
    for name,(yaw,pitch) in DIRECTIONS.items():
        vertices=poses[name].setdefault('vertices',[project_neck_point(point,pivot,volume,yaw*yaw_extent,pitch*pitch_extent*pitch_gain) for point in points])
        if np.asarray(vertices).shape!=(len(points),2) or not np.isfinite(vertices).all():raise ValueError('Invalid neck pose vertices')
    return {'pivot':pivot,'anchor_part':anchor,'part_ids':members,'poses':poses,'yaw_extent':yaw_extent,'pitch_extent':pitch_extent,'layout_mode':extent.get('layout_mode','legacy'),'surface':extent.get('surface'),'volume':volume,'mesh_signature':mesh_signature,'mesh':{'points':points,'triangles':triangles}}



def suggest_neck_poses(parts,members):
    """Nine editable yaw/pitch layouts. Closed eyes/mouth inherit their open owner."""
    poses={}
    face=next(parts[pid] for pid in members if parts[pid]['role']=='face')
    cx=face['x']+face['w']/2;unit=face['w']/463
    for name,(yaw,pitch) in DIRECTIONS.items():
        entries={}
        for pid in members:
            p=parts[pid]
            if p.get('transform_from'):continue
            role=p['role'];side=1 if p['x']+p['w']/2>cx else -1
            s={'x':0,'y':0,'rotation':0,'scale_x':1,'scale_y':1}
            if role=='face':s.update(x=yaw*2*unit,y=pitch*1.2*unit,scale_x=1-.012*abs(yaw),scale_y=1-.012*abs(pitch))
            elif role in ('eye','brow'):s.update(x=yaw*(2.5+.5*side)*unit,y=pitch*2*unit,scale_x=1+yaw*side*.035,scale_y=1-.03*abs(pitch))
            if role=='eye' and yaw and pitch:s.update(scale_x=1,scale_y=1)
            if role=='mouth':s.update(x=yaw*2*unit,y=pitch*1.5*unit)
            elif role=='hair':s.update(x=-yaw*unit,y=pitch*.4*unit,rotation=-yaw*.4)
            elif role=='ribbon':s.update(x=yaw*.8*unit,y=pitch*.4*unit,rotation=-yaw*.3)
            entries[pid]=s
        poses[name]={'parts':entries}
    return poses


def project_neck_point(point,pivot,volume,yaw,pitch):
    x,y=point;dx=x-pivot['x'];dy=y-pivot['y'];v=volume
    radius=((x-v['center']['x'])/v['radius_x'])**2+((y-v['center']['y'])/v['radius_y'])**2
    attach=max(0,min(1,(pivot['y']-y)/max(1,pivot['y']-v['center']['y'])))
    z=v['depth']*np.exp(-1.4*radius)*attach
    cy,sy=np.cos(np.deg2rad(yaw)),np.sin(np.deg2rad(yaw));cx,sx=np.cos(np.deg2rad(pitch)),-np.sin(np.deg2rad(pitch))
    px=cy*dx+sy*z;z1=-sy*dx+cy*z;py=cx*dy-sx*z1;z2=sx*dy+cx*z1
    camera=max(v['radius_x'],v['radius_y'])*8;scale=(camera-z)/(camera-z2)
    return [float(pivot['x']+px*scale),float(pivot['y']+py*scale)]
