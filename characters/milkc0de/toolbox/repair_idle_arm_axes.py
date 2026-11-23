"""Refit shoulder, elbow and wrist axes in Milkc0de's registered idle take.

Run with NumPy and SciPy, passing a source GLB and the path of the new GLB.
The source character's skin and recorded animation supply the section planes,
joint timing, wrist poses and mirrored carrying angles.
"""
import argparse
import json
import struct
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation


def read_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', data)
    json_len, tag = struct.unpack_from('<I4s', data, 12)
    assert (magic, version, length, tag) == (b'glTF', 2, len(data), b'JSON')
    doc = json.loads(data[20:20+json_len])
    return doc, bytearray(data[28+json_len:28+json_len+doc['buffers'][0]['byteLength']])


def write_glb(path, doc, data):
    js = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    data.extend(bytes(-len(data) % 4))
    temp = path.with_suffix(path.suffix + '.part')
    with temp.open('wb') as stream:
        stream.write(struct.pack('<4sIII4s', b'glTF', 2, 28+len(js)+len(data), len(js), b'JSON'))
        stream.write(js)
        stream.write(struct.pack('<I4s', len(data), b'BIN\0'))
        stream.write(data)
    temp.replace(path)


def array(doc, data, index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    assert 'byteStride' not in view and 'sparse' not in a
    dtype = {5121: 'u1', 5125: '<u4', 5126: '<f4'}[a['componentType']]
    width = {'SCALAR':1, 'VEC3':3, 'VEC4':4, 'MAT4':16}[a['type']]
    return np.frombuffer(data, dtype, a['count']*width, view.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,width)


def replace(doc, data, index, values):
    dst = array(doc, data, index)
    dst[:] = values.reshape(dst.shape)
    a = doc['accessors'][index]
    if 'min' in a:
        a['min'] = dst.min(0).tolist()
        a['max'] = dst.max(0).tolist()


def unit(values):
    return values / np.maximum(np.linalg.norm(values, axis=-1, keepdims=True), 1e-12)


def arm_frame(direction):
    up = unit(direction)
    across = unit(np.cross(up, [0., 0., 1.]))
    return np.stack([across, up, np.cross(across, up)], axis=-1)


def continuous_quats(frames):
    quats = Rotation.from_matrix(frames).as_quat()
    signs = np.r_[1, np.cumprod(np.where((quats[1:]*quats[:-1]).sum(1)<0,-1,1))]
    return quats * signs[:,None]


def section_midpoint(positions, shell, joint, direction):
    """Take the center of a thin anatomical cross-section, independent of tessellation density."""
    axis = unit(direction)
    across = unit(np.cross(axis, [0,0,1]))
    depth = np.cross(across, axis)
    edges = shell[:,[[0,1],[1,2],[2,0]]].reshape(-1,2)
    edges = np.unique(np.sort(edges,axis=1),axis=0)
    signed = (positions-joint) @ axis
    measured = []
    for offset in [-.003,0,.003]:
        crossing = edges[(signed[edges[:,0]]>offset)!=(signed[edges[:,1]]>offset)]
        a,b = crossing.T
        mix = (offset-signed[a])/(signed[b]-signed[a])
        ring = positions[a]+mix[:,None]*(positions[b]-positions[a])
        rel = ring-joint
        lat, z = rel @ across, rel @ depth
        lcenter = .5*(np.quantile(lat,.04)+np.quantile(lat,.96))
        zcenter = .5*(np.quantile(z,.04)+np.quantile(z,.96))
        measured.append(lcenter*across+zcenter*depth)
    return joint+np.median(measured,axis=0)


def repair(doc, data):
    skin = doc['skins'][0]
    joints = skin['joints']
    lookup = {doc['nodes'][node]['name']:i for i,node in enumerate(joints)}
    node_to_index = {node:i for i,node in enumerate(joints)}
    parent = {child:node for node in joints for child in doc['nodes'][node].get('children',[])}
    inverse = skin['inverseBindMatrices']
    old = np.linalg.inv(array(doc,data,inverse).reshape(-1,4,4).transpose(0,2,1)).astype('float64')
    new = old.copy()
    primitive = doc['meshes'][0]['primitives'][0]
    attrs = primitive['attributes']
    p = array(doc,data,attrs['POSITION'])
    tri = array(doc,data,primitive['indices']).reshape(-1,3)
    ji = array(doc,data,attrs['JOINTS_0'])
    weights = array(doc,data,attrs['WEIGHTS_0'])
    clip = next(clip for clip in doc['animations'] if clip['name']=='VTuber Idle')
    tracks = {(doc['nodes'][ch['target']['node']]['name'],ch['target']['path']):clip['samplers'][ch['sampler']]
              for ch in clip['channels']}
    def read_rotation(name):
        return Rotation.from_quat(array(doc,data,tracks[(name,'rotation')]['output'])).as_matrix()
    def write_rotation(name,r):
        replace(doc,data,tracks[(name,'rotation')]['output'],continuous_quats(r))
    def already_hinged(side):
        forearm = Rotation.from_matrix(read_rotation('forearm.'+side))
        relative = (forearm * forearm[0].inv()).as_rotvec()
        clavicle = array(doc,data,tracks[('clavicle.'+side,'translation')]['output'])
        root = doc['nodes'][joints[lookup['clavicle.'+side]]]['translation']
        return (np.max(np.abs(relative[:,1:])) < 1e-6
                and np.ptp(relative[:,0]) > np.deg2rad(5)
                and np.max(np.abs(clavicle-root)) < 1e-6)
    if all(already_hinged(side) for side in ('L','R')):
        return {'status':'already fitted'}
    report={}
    for side,sign in [('L',1),('R',-1)]:
        clav, hum, fore, hand = [name+'.'+side for name in ('clavicle','upper_arm','forearm','hand')]
        ci,hi,fi,wi = [lookup[n] for n in (clav,hum,fore,hand)]
        ids = [ci,hi,fi,wi]
        arm = (np.isin(ji,ids)*weights).sum(1)>.55
        shell = tri[arm[tri].all(1)]
        for i in [hi,fi,wi]:
            new[i,:3,3] = section_midpoint(p,shell,old[i,:3,3],old[i,:3,1])
        new[ci,:3,:3] = arm_frame(new[hi,:3,3]-new[ci,:3,3])
        new[hi,:3,:3] = arm_frame(new[fi,:3,3]-new[hi,:3,3])
        new[fi,:3,:3] = arm_frame(new[wi,:3,3]-new[fi,:3,3])
        pure = (weights*(ji==wi)).sum(1)>.998
        hand_axis = unit(np.median(p[pure],axis=0)-new[wi,:3,3])
        new[wi,:3,:3] = arm_frame(hand_axis)
        for i in ids:
            node = joints[i]
            local = np.linalg.solve(new[node_to_index[parent[node]]],new[i])
            doc['nodes'][node]['rotation'] = Rotation.from_matrix(local[:3,:3]).as_quat().tolist()
            doc['nodes'][node]['translation'] = local[:3,3].tolist()

        # Retain the take timing and the distinct gestures of its original left/right arm.
        # Z points toward the viewer. Flexion turns a hanging forearm toward Z as a hinge.
        old_upper = old[ci,:3,:3] @ read_rotation(hum)
        old_fore = old_upper @ read_rotation(fore)
        old_hand = old_fore @ read_rotation(hand)
        direction = old_upper[:,:,1]
        lean = np.arctan2(sign*direction[:,0],-direction[:,1])+np.deg2rad(2.3)
        pitch = .75*np.arcsin(direction[:,2])
        forward = np.stack([sign*np.sin(lean)*np.cos(pitch),-np.cos(lean)*np.cos(pitch),np.sin(pitch)],axis=1)
        upper = arm_frame(forward)
        write_rotation(hum,new[ci,:3,:3].T @ upper)
        # Chest and clavicle move the shoulder; keep the collarbone root attached to the chest.
        chest = node_to_index[parent[joints[ci]]]
        old_clav_rest = old[chest,:3,:3].T @ old[ci,:3,:3]
        new_clav_rest = new[chest,:3,:3].T @ new[ci,:3,:3]
        write_rotation(clav,read_rotation(clav) @ old_clav_rest.T @ new_clav_rest)
        clav_t=tracks[(clav,'translation')]['output']
        rest_t=np.asarray(doc['nodes'][joints[ci]]['translation'])
        replace(doc,data,clav_t,np.broadcast_to(rest_t,array(doc,data,clav_t).shape))
        # Keeping the carrying angle in a constant base pose gives a single local X flexion axis.
        elbow_rest = new[hi,:3,:3].T @ new[fi,:3,:3]
        elbow_rest_angle = np.arctan2(elbow_rest[2,1],elbow_rest[1,1])
        elbow_base = Rotation.from_euler('x',-elbow_rest_angle).as_matrix() @ elbow_rest
        flex = np.arccos(np.clip(np.sum(old_upper[:,:,1]*old_fore[:,:,1],axis=1),-1,1))
        flex = np.clip(flex+np.deg2rad(2.),np.deg2rad(11),np.deg2rad(42))
        elbow = Rotation.from_euler('x',flex[:,None]).as_matrix() @ elbow_base
        write_rotation(fore,elbow)
        # A loose wrist follows the forearm with a small extension; it no longer chases
        # an independent world-space aim that rolls the palm when the elbow swings.
        wrist_rest = new[fi,:3,:3].T @ new[wi,:3,:3]
        old_rel = old_fore.transpose(0,2,1) @ old_hand
        extension = np.clip(.64*np.arctan2(old_rel[:,2,1],old_rel[:,1,1]),-.17,.10)
        write_rotation(hand,Rotation.from_euler('x',extension[:,None]).as_matrix() @ wrist_rest)
        report[side]={'old':old[ids[1:],:3,3].round(5).tolist(),'new':new[ids[1:],:3,3].round(5).tolist(),
                      'flexionDegrees':np.round(np.rad2deg([flex.min(),flex.max()]),2).tolist()}
    replace(doc,data,inverse,np.linalg.inv(new).transpose(0,2,1).reshape(-1,16))
    return report


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    args = parser.parse_args()
    doc, data = read_glb(args.source)
    from turn_idle_palms_inward import turn_palms
    report = repair(doc, data)
    report['idlePalms'] = turn_palms(doc, data)
    write_glb(args.output, doc, data)
    print(json.dumps(report, indent=2))
