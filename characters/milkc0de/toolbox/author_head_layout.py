#!/usr/bin/env python3
"""Author this sample's nine 2D head layouts without rebuilding any image.

The source lattice and part geometry are immutable inputs. Previous deformed
poses are never reused, so this can be rerun from a fresh clone without work/.
"""
import argparse, copy, hashlib, json, math, shutil, sys
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from head_pose import pose_weights
DIRECTIONS=('center','left','right','up','down','up_left','up_right','down_left','down_right')

def easing(value):
    value=np.clip(value,0,1)
    return value*value*(3-2*value)

def neutral(count):
    return {'x':0.,'y':0.,'rotation':0.,'scale_x':1.,'scale_y':1.,'vertices':[[0.,0.] for _ in range(count)]}

def author(profile,project,plan):
    if profile.get('format')!='ChibiRigHeadLayoutProfile' or profile.get('version')!=1:
        raise ValueError('Unsupported head layout profile')
    if set(profile['endpoints'])!=set(DIRECTIONS):raise ValueError('Exactly nine endpoints are required')
    strength=profile.get('strength',1.)
    if isinstance(strength,bool) or not isinstance(strength,(int,float)) or not math.isfinite(strength) or not 0<=strength<=1:
        raise ValueError('Head layout strength must be finite and in 0..1')
    p=copy.deepcopy(project);plan=copy.deepcopy(plan);h=p['head_pose'];n=p['neck_sway'];parts=p['parts']
    count=(h['columns']+1)*(h['rows']+1)
    points=np.asarray(n['mesh']['points'],dtype=float);center=np.asarray(profile['center'],dtype=float)
    band=profile['attachment_band'];start,end=band['start_y'],band['end_y']
    if not math.isfinite(start) or not math.isfinite(end) or not start<end:raise ValueError('Invalid attachment band')
    attachment=1-easing((points[:,1]-start)/(end-start))
    delta=points-center
    cheek=np.exp(-.5*((delta[:,0]/210)**2+((points[:,1]-520)/105)**2))
    crown=np.exp(-.5*((delta[:,0]/360)**2+((points[:,1]-150)/240)**2))
    for name in DIRECTIONS:
        endpoint=profile['endpoints'][name];s=endpoint['surface'];shift=np.asarray(s['shift'],dtype=float)
        correction=np.column_stack([delta[:,0]*(s['width']-1),delta[:,1]*(s['height']-1)])+shift
        correction+=cheek[:,None]*np.asarray(s['cheek'],dtype=float)
        correction[:,1]+=crown*s['crown_lift']
        vertices=points+correction*attachment[:,None]
        if not np.isfinite(vertices).all():raise ValueError('Nonfinite endpoint')
        layout={pid:neutral(count) for pid in h['part_ids'] if not parts[pid].get('transform_from')}
        for pid,setting in endpoint['parts'].items():
            if pid not in layout:raise ValueError('Unknown owner '+pid)
            if set(setting)-{'x','y','rotation','scale_x','scale_y'}:raise ValueError('Unsupported local setting')
            for key,value in setting.items():
                if not isinstance(value,(int,float)) or not math.isfinite(value):raise ValueError('Nonfinite setting')
                if key.startswith('scale_') and not .55<=value<=1.35:raise ValueError('Art-directed scale must be in 0.55..1.35')
                if not key.startswith('scale_') and abs(value)>40:raise ValueError('Local setting exceeds art profile limits')
            layout[pid].update(setting)
        h['poses'][name]={'parts':layout,'status':'authored'}
        n['poses'][name]={'parts':{},'vertices':vertices.tolist(),'status':'authored'}
    # Keep the raw endpoint artwork in the profile. Moderate every authored
    # displacement around its own center after constructing the nine layouts,
    # including a future center which has non-neutral placements or geometry.
    if strength!=1:
        center_vertices=np.asarray(n['poses']['center']['vertices'],dtype=float)
        center_parts=h['poses']['center']['parts']
        for name in DIRECTIONS:
            if name=='center':continue
            target=np.asarray(n['poses'][name]['vertices'],dtype=float)
            n['poses'][name]['vertices']=(center_vertices+(target-center_vertices)*strength).tolist()
            for pid,setting in h['poses'][name]['parts'].items():
                baseline=center_parts[pid]
                for key,value in setting.items():
                    origin=np.asarray(baseline[key],dtype=float)
                    setting[key]=(origin+(np.asarray(value,dtype=float)-origin)*strength).tolist()
    h['pose_space']=profile['pose_space']
    n.update(layout_mode=profile['layout_mode'],yaw_extent=profile['yaw_extent'],pitch_extent=profile['pitch_extent'],
             surface={'method':'authored-2d-endpoints','center':profile['center'],'attachment_band':band,'strength':strength})
    if p.get('neck_fill'):p['neck_fill']['enabled']=False
    plan['head_pose'].update(poses=copy.deepcopy(h['poses']),pose_space=h['pose_space'])
    for key in ['poses','yaw_extent','pitch_extent','layout_mode','surface']:plan['neck_sway'][key]=copy.deepcopy(n[key])
    if plan.get('neck_fill'):plan['neck_fill']['enabled']=False
    validate(p)
    return p,plan

def validate(project):
    n=project['neck_sway'];tri=np.asarray(n['mesh']['triangles']);source=np.asarray(n['mesh']['points'])
    minimum=math.inf
    for y in np.linspace(-1,1,33):
        for x in np.linspace(-1,1,33):
            dest=sum(np.asarray(n['poses'][name]['vertices'])*weight for name,weight in pose_weights(x,y).items())
            a,b,c=dest[tri[:,0]],dest[tri[:,1]],dest[tri[:,2]]
            area=(b[:,0]-a[:,0])*(c[:,1]-a[:,1])-(b[:,1]-a[:,1])*(c[:,0]-a[:,0])
            minimum=min(minimum,float(area.min()))
            if (area<=.0001).any():raise ValueError('Authored mesh folds between endpoints')
    band=n['surface']['attachment_band'];pinned=source[:,1]>=band['end_y']
    for pose in n['poses'].values():
        if not np.array_equal(np.asarray(pose['vertices'])[pinned],source[pinned]):raise ValueError('Body attachment moved')
    return {'sampledLayouts':1089,'minimumTriangleDoubleArea':minimum,'pinnedVertices':int(pinned.sum())}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--profile',type=Path,default=ROOT/'head-layout.profile.json');ap.add_argument('--apply',action='store_true');args=ap.parse_args()
    profile=json.loads(args.profile.read_text());project=json.loads((ROOT/'rig.project.json').read_text());plan=json.loads((ROOT/'rig.plan.json').read_text())
    candidate,candidate_plan=author(profile,project,plan)
    work=ROOT/'work/eight-direction';work.mkdir(parents=True,exist_ok=True)
    for filename,data in [('candidate-project.json',candidate),('candidate-plan.json',candidate_plan)]:
        (work/filename).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    if args.apply:
        backup=ROOT/'work/eight-direction-original';backup.mkdir(parents=True,exist_ok=True)
        for filename,data in [('rig.project.json',candidate),('rig.plan.json',candidate_plan)]:
            if not (backup/filename).exists():shutil.copy2(ROOT/filename,backup/filename)
            (ROOT/filename).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    preserved={key:project[key]==candidate[key] for key in ['parts','sources','groups','draw_order','settings','canvas']}
    preserved_hashes={key:hashlib.sha256(json.dumps(candidate[key],sort_keys=True,separators=(',',':')).encode()).hexdigest() for key in preserved}
    if not all(preserved.values()):raise ValueError('Authored layout changed immutable rig data')
    report={**validate(candidate),'applied':args.apply,'strength':profile.get('strength',1.),'profileSha256':hashlib.sha256(args.profile.read_bytes()).hexdigest(),'sourceImagesChanged':not preserved['parts'],'preservedRigSections':preserved,'preservedSectionSha256':preserved_hashes,'inputImagesRewritten':False,'previousPosesUsedAsInput':False}
    (work/'authoring-checks.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if __name__=='__main__':main()
