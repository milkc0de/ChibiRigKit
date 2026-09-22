#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
from __future__ import annotations
import json, shutil, html, math, base64, hashlib
import numpy as np
from head_pose import build_head_pose, build_neck_sway, fill_sclera
from rig_contract import validate_plan, verify_sources, digest, local_path, validate_project
from pathlib import Path
from player_output import preview_path, export_player, launcher_files
from PIL import Image, ImageChops

ROOT=Path(__file__).resolve().parents[1]
PLAN_PATH=ROOT/'rig.plan.json'
if not PLAN_PATH.exists():raise SystemExit('rig.plan.json がありません')
plan=json.loads(PLAN_PATH.read_text())
validate_plan(ROOT, plan)
verify_sources(ROOT)
reg=json.loads((ROOT/'work'/'registration.json').read_text())
W,H=reg['canvas']['width'],reg['canvas']['height']
blink_cfg=json.loads((ROOT/'character.config.json').read_text()).get('blink',{})
if not 0<=blink_cfg.get('closed_eye_swap_start',.92)<blink_cfg.get('closed_eye_swap_end',.995)<=1:
    raise ValueError('blink swap thresholds must satisfy 0 <= start < end <= 1')
for p in [ROOT/'assets/layers',ROOT/'assets/masks',ROOT/'assets/sources']:
    p.mkdir(parents=True,exist_ok=True)

def aligned(role):return ROOT/'work'/'aligned'/f'{role}.png'
def default_motion(role):
    defaults={
      'hair':dict(rot_deg=1.4,x_px=1.2,y_px=.8,scale_x_pct=.05,scale_y_pct=.12,phase=.15,freq=1),
      'ribbon':dict(rot_deg=2.8,x_px=.8,y_px=.7,scale_x_pct=.05,scale_y_pct=.12,phase=.3,freq=1),
      'arm':dict(rot_deg=1.2,x_px=.35,y_px=.35,scale_x_pct=0,scale_y_pct=0,phase=.15,freq=1),
      'leg':dict(rot_deg=.55,x_px=.15,y_px=.25,scale_x_pct=0,scale_y_pct=0,phase=.05,freq=1),
      'torso':dict(rot_deg=.35,x_px=.25,y_px=.75,scale_x_pct=.03,scale_y_pct=.12,phase=0,freq=1),
      'skirt':dict(rot_deg=.75,x_px=.35,y_px=.5,scale_x_pct=.08,scale_y_pct=.15,phase=.1,freq=1),
      'face':dict(rot_deg=.18,x_px=.1,y_px=.12,scale_x_pct=0,scale_y_pct=0,phase=0,freq=1),
      'eye':dict(rot_deg=.12,x_px=.08,y_px=.08,scale_x_pct=0,scale_y_pct=0,phase=0,freq=1),
      'mouth':dict(rot_deg=.08,x_px=.05,y_px=.05,scale_x_pct=0,scale_y_pct=0,phase=.25,freq=1),
      'base':dict(rot_deg=0,x_px=0,y_px=0,scale_x_pct=0,scale_y_pct=0,phase=0,freq=1),
    }
    return defaults.get(role,defaults['face']).copy()

def load_mask(path):
    p=local_path(ROOT,path);im=Image.open(p).convert('L')
    if im.size!=(W,H):raise ValueError(f'{path}: mask size {im.size} != {(W,H)}')
    return im

parts={}
specs={p['id']:p for p in plan['parts']}
for spec in plan['parts']:
    pid=spec['id']; role=spec.get('role','normal'); source_role=spec.get('source','normal'); source=Image.open(aligned(source_role)).convert('RGBA')
    mask=load_mask(spec['mask'])
    if source.size != (W,H):raise ValueError(f'{pid}: source canvas mismatch')
    if spec['kind']=='eye_sclera':source,sclera_color=fill_sclera(ROOT,spec,specs,source,mask)
    # Repair only an explicitly selected part-local region; originals stay immutable.
    if repair := spec.get('texture_repair'):
        patch=Image.open(local_path(ROOT,repair['file'])).convert('RGBA')
        if patch.size != (W,H):raise ValueError(f'{pid}: repair must use full canvas')
        repair_mask=ImageChops.multiply(load_mask(repair['mask']),mask)
        patch.putalpha(ImageChops.multiply(patch.getchannel('A'),repair_mask))
        source=Image.alpha_composite(source,patch)
    alpha=ImageChops.multiply(source.getchannel('A'),mask);rgba=source.copy();rgba.putalpha(alpha);bb=alpha.getbbox()
    if not bb:raise ValueError(f'{pid}: empty mask')
    pad=int(spec.get('pad',8));x0=max(0,bb[0]-pad);y0=max(0,bb[1]-pad);x1=min(W,bb[2]+pad);y1=min(H,bb[3]+pad)
    layer_rel=f'assets/layers/{pid}.png';mask_rel=f'assets/masks/{pid}.png';rgba.crop((x0,y0,x1,y1)).save(ROOT/layer_rel);mask.save(ROOT/mask_rel)
    pivot=spec.get('pivot') or [(x0+x1)/2,(y0+y1)/2];motion=default_motion(role);motion.update(spec.get('motion') or {})
    part={'name':pid,'file':layer_rel,'mask':mask_rel,'x':x0,'y':y0,'w':x1-x0,'h':y1-y0,'pivot':{'x':float(pivot[0]),'y':float(pivot[1])},'motion':motion,'parent':spec.get('parent'),'opacity':float(spec.get('opacity',1)),'kind':spec.get('kind','normal'),'role':role}
    part['sha256']=digest(ROOT/layer_rel)
    part['image_data_url']='data:image/png;base64,'+base64.b64encode((ROOT/layer_rel).read_bytes()).decode()
    if spec.get('mesh'):part['mesh']=dict(spec['mesh'])
    for key in ('closed_part','transform_from','clip_to','iris_part','capture_side','physics'):
        if spec.get(key):part[key]=spec[key]
    if 'head' in spec:part['head']=spec['head']
    if spec['kind']=='eye_sclera':part['sclera_fill']=sclera_color
    if spec['kind'] in ('eye_iris','eye_line'):part['transform_from']=spec['clip_to']
    if seam := spec.get('seam'):
        patch=Image.open(local_path(ROOT,seam['file'])).convert('RGBA')
        if patch.size != (W,H):raise ValueError(f'{pid}: seam must use full canvas')
        # Explicit joint mask AND original silhouette; shoe tips/exterior stay untouched.
        interior=Image.open(aligned('normal')).convert('RGBA').getchannel('A')
        seam_mask=ImageChops.multiply(load_mask(seam['mask']),interior)
        patch.putalpha(ImageChops.multiply(patch.getchannel('A'),seam_mask))
        rel=f'assets/layers/{pid}.seam.png';patch.crop((x0,y0,x1,y1)).save(ROOT/rel)
        part['seam']={'file':rel,'sha256':digest(ROOT/rel),'data_url':'data:image/png;base64,'+base64.b64encode((ROOT/rel).read_bytes()).decode()}
    if spec.get('static_blush'):part['static_blush']=True
    parts[pid]=part

# Paired endpoints share the exact transform; no independent eyelid/mouth drift.
for pid,part in parts.items():
    if closed_id := part.get('closed_part'):
        closed=parts[closed_id]
        owner=part.get('transform_from',pid)
        if closed.get('transform_from',owner) != owner:
            raise ValueError(f'{pid}: closed endpoint has a conflicting transform')
        closed['transform_from']=owner
        mesh=part.setdefault('mesh',{})
        if part['kind'] in ('eye_open','eye_sclera'):
            mesh.setdefault('type','blink_eye_radial')
            mesh.setdefault('close_curve',{'x':closed['x']+closed['w']/2,'y':closed['y']+closed['h']/2,'curvature':0})
        elif part['kind'] in ('mouth_open','mouth_smile'):
            mesh.setdefault('type','mouth_open_close')
            mesh.setdefault('closed_center',{'x':closed['x']+closed['w']/2,'y':closed['y']+closed['h']/2})
            mesh.setdefault('closed_width_ratio',min(1,closed['w']/part['w']))
    mesh=part.get('mesh',{})
    if mesh.get('type')=='blink_eye_radial':
        mesh.setdefault('rings',4);mesh.setdefault('spokes',48);mesh.setdefault('min_open',.015)
        mesh.setdefault('center',{'x':part['x']+part['w']/2,'y':part['y']+part['h']/2})
        mesh.setdefault('close_curve',{'x':mesh['center']['x'],'y':part['y']+mesh.get('close_center_y_local',part['h']/2),'curvature':0})
        # Ray extents encompass selected alpha, including detached antialiased lashes.
        alpha=np.asarray(Image.open(ROOT/part['file']).getchannel('A'))
        ys,xs=np.nonzero(alpha);cx=mesh['center']['x']-part['x'];cy=mesh['center']['y']-part['y']
        angle=np.mod(np.arctan2(ys-cy,xs-cx),2*math.pi);dist=np.hypot(xs-cx,ys-cy)
        radii=[]
        for i in range(mesh['spokes']):
            delta=np.abs((angle-i*2*math.pi/mesh['spokes']+math.pi)%(2*math.pi)-math.pi)
            selected=dist[delta<=2*math.pi/mesh['spokes']]
            radii.append(float(selected.max()+2) if selected.size else 2.)
        mesh['radii']=radii
    if mesh.get('type')=='mouth_open_close':
        mesh.setdefault('center',{'x':part['x']+part['w']/2,'y':part['y']+part['h']/2})
        mesh.setdefault('closed_center',mesh['center'].copy());mesh.setdefault('closed_width_ratio',.75)
        mesh.setdefault('closed_slope',0)
# Validate derived transform links too.
for pid in parts:
    seen=set();current=pid
    while parts[current].get('transform_from'):
        if current in seen:raise ValueError(f'{pid}: endpoint transform cycle')
        seen.add(current);current=parts[current]['transform_from']

# Copy aligned sources for provenance.
sources={}
for role in reg['roles']:
    src=aligned(role);dst=ROOT/'assets/sources'/f'{role}.png';shutil.copy2(src,dst);sources[role]=str(dst.relative_to(ROOT))

project={'name':plan.get('name','Generic Character Rig'),'version':2,'canvas':{'width':W,'height':H,'transparent':True},'sources':sources,'settings':{'duration_seconds':plan.get('duration_seconds',4),'fps':60,'motion_intensity':1,'head_motion_amount':1.5,'gaze_motion_amount':1.5,'neck_sway':True,'neck_sway_degrees':6,'neck_yaw_degrees':12,'neck_pitch_degrees':8,'expression':0,'auto_blink':True,'auto_expression':False,'blink':json.loads((ROOT/'character.config.json').read_text()).get('blink',{})},'groups':plan.get('groups',{}),'parts':parts,'draw_order':plan['draw_order'],'notes':{'generated_by':'ChibiRigKit + Codex app-server','character_plan':str(PLAN_PATH.name)}}
head_pose=build_head_pose(plan,parts,project['canvas'])
if head_pose:
    project['head_pose']=head_pose
    project['settings']['head_random']=plan.get('head_pose',{}).get('autoplay',True)
neck_sway=build_neck_sway(plan,parts,project['canvas'])
if neck_sway:project['neck_sway']=neck_sway
if plan.get('neck_fill'):
    fill=plan['neck_fill'];project['neck_fill']={**fill,'data_url':'data:image/png;base64,'+base64.b64encode((ROOT/fill['file']).read_bytes()).decode()}
# Character-specific motion template omits image bytes and immutable rig geometry.
layout={'canvas':project['canvas'],'draw_order':project['draw_order'],
        'parts':{pid:{k:v for k,v in part.items() if k not in ('motion','image_data_url')} for pid,part in parts.items()},
        'groups':{gid:{k:v for k,v in group.items() if k!='motion'} for gid,group in project['groups'].items()}}
project['motion_layout_signature']=hashlib.sha256(json.dumps(layout,sort_keys=True,separators=(',',':')).encode()).hexdigest()
motion_template={'$schema':'motion.schema.json','format':'chibirigkit.motion','version':1,
                 'layout_signature':project['motion_layout_signature'],'settings':dict(project['settings'],motion_speed=1),
                 'parts':{pid:part.get('motion',{}) for pid,part in parts.items()},
                 'groups':{gid:group.get('motion',{}) for gid,group in project['groups'].items()}}
(ROOT/'motion.template.json').write_text(json.dumps(motion_template,ensure_ascii=False,indent=2)+'\n')
(ROOT/'rig.project.json').write_text(json.dumps(project,ensure_ascii=False,indent=2)+'\n')

tpl=(ROOT/'runtime'/'index.template.html').read_text().replace('__LICENSE_TEXT__',(ROOT/'LICENSE.txt').read_text()).replace('__RECORDING_JS__',(ROOT/'runtime'/'recording.js').read_text()).replace('__BUNDLE_JS__',(ROOT/'runtime'/'bundle.js').read_text()).replace('__HEAD_POSE_JS__',(ROOT/'runtime'/'head_pose.js').read_text()).replace('__PROJECT_IO_JS__',(ROOT/'runtime'/'project_io.js').read_text()).replace('__BACKGROUND_JS__',(ROOT/'runtime'/'background.js').read_text()).replace('__MOTION_CLIP_JS__',(ROOT/'runtime'/'motion_clip.js').read_text()).replace('__CAPTURE_PLAYER_JS__',(ROOT/'runtime'/'capture_player.js').read_text()).replace('__EXPRESSION_UNDERPAINT_JS__',(ROOT/'runtime'/'expression_underpaint.js').read_text()).replace('__HAIR_DYNAMICS_JS__',(ROOT/'runtime'/'hair_dynamics.js').read_text()).replace('__HAIR_PLAYER_JS__',(ROOT/'runtime'/'hair_player.js').read_text()).replace('__TRACKING_CORE_JS__',(ROOT/'runtime'/'tracking_core.js').read_text()).replace('__TRACKING_JS__',(ROOT/'runtime'/'tracking.js').read_text()).replace('__OUTPUT_JS__',(ROOT/'runtime'/'output.js').read_text()).replace('__PLAYER_SYNC_JS__',(ROOT/'runtime'/'player_sync.js').read_text())
payload=json.dumps(project,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
rendered=tpl.replace('__PLAYER_LAUNCHERS_JSON__',json.dumps(launcher_files(),ensure_ascii=False).replace('<','\\u003c')).replace('__TITLE__',html.escape(project['name'])).replace('__W__',str(W)).replace('__H__',str(H)).replace('__PROJECT_JSON__',payload)
preview_path(ROOT).parent.mkdir(parents=True,exist_ok=True)
preview_path(ROOT).write_text(rendered)
validate_project(ROOT,project)
export_player(ROOT,rendered,project)
print(json.dumps({'parts':len(parts),'canvas':[W,H],'project':'rig.project.json'},ensure_ascii=False))
