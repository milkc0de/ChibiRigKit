"""Set the relaxed idle hand roll so the palms face inward and the thumbs are visible."""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation

from repair_idle_arm_axes import array, continuous_quats, read_glb, replace, unit, write_glb


def surface_frame(doc, data, prim, hand_index, fore_index, side):
    """Measure the hand center plane and thumb side from the registered captured hand."""
    attr = prim['attributes']
    vertices = array(doc, data, attr['POSITION'])
    joints, weights = array(doc, data, attr['JOINTS_0']), array(doc, data, attr['WEIGHTS_0'])
    hand = np.sum(weights * (joints == hand_index), axis=1)
    combined = np.sum(weights * np.isin(joints, [hand_index,fore_index]), axis=1)
    triangles = array(doc, data, prim['indices']).reshape(-1,3)
    shell = vertices[triangles[(combined[triangles]>.93).all(axis=1)]].astype(float)
    uv_acc = doc['accessors'][attr['TEXCOORD_0']]
    uv_view = doc['bufferViews'][uv_acc['bufferView']]
    uv = np.frombuffer(data,'<f4',uv_acc['count']*2,uv_view.get('byteOffset',0)+uv_acc.get('byteOffset',0)).reshape(-1,2)
    # The registered full-resolution frontal chart starts at atlas pixel (8,8),
    # sourced from (119,20). Interior texels preserve the exact camera fit.
    px = uv*4096 + [110.5,11.5]
    mirrored_x = 574 + side*(px[:,0]-574)
    ok = (hand>.999)&(mirrored_x>815)&(mirrored_x<916)&(px[:,1]>827)&(px[:,1]<879)
    scale = np.array([1338.91485,-1338.91485])
    translations,count = np.unique(np.round(vertices[ok,:2]-px[ok]/scale,5),axis=0,return_counts=True)
    if len(count)==0 or count.max()<80:
        raise ValueError('The registered solid five-finger hand could not be matched.')
    offset = translations[count.argmax()]
    def xy(art):
        return np.array([574+side*(art[0]-574),art[1]])/scale + offset
    def depth_at(point):
        a,b,c=shell.transpose(1,0,2)
        u=b[:,:2]-a[:,:2];v=c[:,:2]-a[:,:2];q=point-a[:,:2]
        det=u[:,0]*v[:,1]-u[:,1]*v[:,0];den=np.where(abs(det)>1e-12,det,1)
        b1=(q[:,0]*v[:,1]-q[:,1]*v[:,0])/den
        b2=(u[:,0]*q[:,1]-u[:,1]*q[:,0])/den
        hit=(abs(det)>1e-12)&(b1>=-1e-6)&(b2>=-1e-6)&(b1+b2<=1.000001)
        z=(a[:,2]+b1*(b[:,2]-a[:,2])+b2*(c[:,2]-a[:,2]))[hit]
        return (.5*(z.max()+z.min())) if len(z)>1 else np.nan
    pilot=unit(np.array([.643,.766])); across=np.array([pilot[1],-pilot[0]])
    mids=[]
    for station in (37,42,47,52,57):
        for lateral in (-13,-7,0,7,13):
            point=xy(np.array([832.,806.])+station*pilot+lateral*across)
            z=depth_at(point)
            if np.isfinite(z): mids.append([*point,z])
    mid=np.asarray(mids)
    if len(mid)<16: raise ValueError('Insufficient paired hand surfaces for the palm center plane.')
    dz=np.linalg.lstsq(np.c_[mid[:,:2],np.ones(len(mid))],mid[:,2],rcond=None)[0]
    # The featureless frontal art cannot distinguish palm from dorsum by color.
    # The short digit originates on the medial side of this particular hand.
    normal=unit(np.array([-dz[0],-dz[1],1.]))
    crease_xy=xy([835.5,808.]);crease_depth=depth_at(crease_xy)
    if not np.isfinite(crease_depth): raise ValueError('Cannot find the exposed wrist junction.')
    crease=np.r_[crease_xy,crease_depth]
    def in_plane(point):
        return np.r_[point,dz[:2]@point+dz[2]]
    shaft=unit(in_plane(xy([863.,845.]))-in_plane(crease_xy))
    thumb=unit(in_plane(xy([837.,873.]))-in_plane(xy([863.,845.])))
    thumb=unit(thumb-shaft*(shaft@thumb))
    return crease,shaft,normal,thumb


def store_vec3(doc,data,values):
    values=np.ascontiguousarray(values,dtype='<f4')
    data.extend(bytes(-len(data)%4))
    view=len(doc['bufferViews'])
    doc['bufferViews'].append({'buffer':0,'byteOffset':len(data),'byteLength':values.nbytes})
    data.extend(values.tobytes())
    index=len(doc['accessors'])
    doc['accessors'].append({'bufferView':view,'count':len(values),'componentType':5126,'type':'VEC3',
                             'min':values.min(0).tolist(),'max':values.max(0).tolist()})
    return index


def turn_palms(doc,data):
    clip=next(item for item in doc['animations'] if item['name']=='VTuber Idle')
    version = clip.get('extras', {}).get('relaxedPalmOrientation')
    if version == 'relaxed-dorsal-roll-v3':
        return {'status': 'already applied'}
    if version == 'relaxed-dorsal-roll-v2':
        previous = clip['extras'].get('relaxedDorsalRollDegrees', 25.)
        return reveal_hand_backs(doc, data, clip, previous)
    if version == 'thumb-forward-inward-v1':
        return reveal_hand_backs(doc, data, clip)
    skin=doc['skins'][0]
    joint_nodes=skin['joints']
    names={doc['nodes'][n]['name']: i for i,n in enumerate(joint_nodes)}
    bind=np.linalg.inv(array(doc,data,skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1))
    prim=doc['meshes'][0]['primitives'][0]
    tracks={(doc['nodes'][ch['target']['node']]['name'],ch['target']['path']):clip['samplers'][ch['sampler']]
            for ch in clip['channels']}
    def rotations(name):
        return Rotation.from_quat(array(doc,data,tracks[(name,'rotation')]['output'])).as_matrix()
    reports={}
    for label,side in [('L',1),('R',-1)]:
        clav,humerus,forearm,hand=[n+'.'+label for n in ('clavicle','upper_arm','forearm','hand')]
        fi,hi=names[forearm],names[hand]
        crease,shaft,normal,thumb=surface_frame(doc,data,prim,hi,fi,side)
        input_key=tracks[(hand,'rotation')]['input']
        for n in [clav,humerus,forearm]:
            if tracks[(n,'rotation')]['input']!=input_key:
                raise ValueError('Expected synchronized authored arm samples.')
        fore=rotations(forearm);wrist=rotations(hand)
        chest=bind[names['chest'],:3,:3]
        world=chest@rotations(clav)@rotations(humerus)@fore@wrist
        hand_basis=bind[hi,:3,:3]
        frame=world@hand_basis.T
        axis=unit(frame@shaft);front=unit(frame@normal);radial=unit(frame@thumb)
        camera=np.array([0.,0.,1.])
        edge=unit(np.cross(axis,camera))
        # Both edge-on signs look thin from the front. Select the one that brings
        # the short, proximal thumb forward rather than behind the little finger.
        options=[]
        for target in [edge,-edge]:
            angle=np.arctan2(np.einsum('ij,ij->i',np.cross(front,target),axis),
                             np.einsum('ij,ij->i',front,target))
            rolled=Rotation.from_rotvec(axis*angle[:,None]).as_matrix()
            thumb_front=np.einsum('nij,nj->ni',rolled,radial)[:,2]
            options.append((np.mean(thumb_front),angle,thumb_front))
        _,angle,thumb_front=max(options,key=lambda option:option[0])
        if np.mean(abs(angle))<np.deg2rad(60) or np.mean(abs(angle))>np.deg2rad(125):
            raise ValueError('Palm roll failed the near-quarter-turn anatomical check.')
        # A small constant shaft roll on the forearm preserves its flexion axis.
        # Skinning already blends the remaining roll across the distal cuff.
        share=np.sign(np.median(angle))*np.deg2rad(12.)
        fore_roll=Rotation.from_rotvec([0.,share,0.]).as_matrix()
        wrist_axis=unit(hand_basis.T@shaft)
        relative=Rotation.from_rotvec(wrist_axis[None,:]*angle[:,None]).as_matrix()
        replace(doc,data,tracks[(forearm,'rotation')]['output'],continuous_quats(fore@fore_roll))
        replace(doc,data,tracks[(hand,'rotation')]['output'],continuous_quats(fore_roll.T@wrist@relative))
        # Pivot at the exposed wrist crease without changing the editable A-pose
        # bind. This compensation keeps the crease on the old sleeve trajectory.
        wrist_node=doc['nodes'][joint_nodes[hi]]
        origin=np.asarray(wrist_node['translation'])
        offset=hand_basis.T@(crease-bind[hi,:3,3])
        t=(origin + np.einsum('nij,nj->ni',wrist,offset-relative@offset))@fore_roll
        key=(hand,'translation')
        if key in tracks:
            raise ValueError('This source has an unrecognized hand translation take.')
        out=store_vec3(doc,data,t)
        sampler=len(clip['samplers'])
        clip['samplers'].append({'input':input_key,'output':out,'interpolation':'LINEAR'})
        clip['channels'].append({'sampler':sampler,'target':{'node':joint_nodes[hi],'path':'translation'}})
        reports[label]={'rollDegrees':np.rad2deg(np.percentile(angle,[0,50,100])).round(2).tolist(),
                        'thumbForwardProjection':np.percentile(thumb_front,[0,50,100]).round(3).tolist(),
                        'initialCameraFacing':np.percentile(front[:,2],[0,50,100]).round(3).tolist(),
                        'crease':crease.round(5).tolist(),'axis':shaft.round(5).tolist(),'normal':normal.round(5).tolist()}
    doc['buffers'][0]['byteLength']=len(data)
    clip.setdefault('extras',{})['relaxedPalmOrientation']='thumb-forward-inward-v1'
    roll = reveal_hand_backs(doc, data, clip)
    for side in reports:
        reports[side].update(roll[side])
    return reports


def reveal_hand_backs(doc, data, clip, previous_degrees=0.):
    # The previous fit deliberately faced each palm fully inward. A small
    # pronation exposes the short thumb and the back of the hand from the front.
    degrees = 20.
    skin = doc['skins'][0]
    nodes = skin['joints']
    names = {doc['nodes'][n]['name']: i for i, n in enumerate(nodes)}
    bind = np.linalg.inv(array(doc,data,skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1))
    body = doc['meshes'][0]['primitives'][0]
    tracks = {(doc['nodes'][c['target']['node']]['name'], c['target']['path']): clip['samplers'][c['sampler']]['output']
              for c in clip['channels']}
    reports = {}
    for side, sign in [('L',1), ('R',-1)]:
        fore, hand = 'forearm.' + side, 'hand.' + side
        hi = names[hand]
        crease, _, _, _ = surface_frame(doc,data,body,hi,names[fore],sign)
        original_fore = Rotation.from_quat(array(doc,data,tracks[fore,'rotation'])).as_matrix()
        original_hand = Rotation.from_quat(array(doc,data,tracks[hand,'rotation'])).as_matrix()
        origins = array(doc,data,tracks[hand,'translation']).astype(float)
        # Roll about the elbow-to-wrist shaft, retaining its authored flexion.
        # The joint's local Y runs down the forearm. Distribute 45% of the
        # angle over the forearm. The wrist supplies the rest at its skin crease.
        angle = np.deg2rad(degrees - previous_degrees) * sign
        full_roll = Rotation.from_rotvec([0.,angle,0.]).as_matrix()
        forearm_roll = Rotation.from_rotvec([0.,.45*angle,0.]).as_matrix()
        new_fore = original_fore @ forearm_roll
        new_hand = forearm_roll.T @ full_roll @ original_hand
        offset = bind[hi,:3,:3].T @ (crease - bind[hi,:3,3])
        crease_path = origins + original_hand @ offset
        new_origins = (crease_path - (full_roll @ original_hand) @ offset) @ forearm_roll
        replace(doc,data,tracks[fore,'rotation'],continuous_quats(new_fore))
        replace(doc,data,tracks[hand,'rotation'],continuous_quats(new_hand))
        replace(doc,data,tracks[hand,'translation'],new_origins)
        reports[side] = {'dorsalRollDegrees': degrees}
    clip['extras']['relaxedPalmOrientation'] = 'relaxed-dorsal-roll-v3'
    clip['extras']['relaxedDorsalRollDegrees'] = degrees
    return reports


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    doc,data=read_glb(args.source)
    print(json.dumps(turn_palms(doc,data),indent=2))
    write_glb(args.output,doc,data)
