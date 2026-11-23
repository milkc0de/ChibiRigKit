"""Gather the rounded fingers and align the short thumb beside the index for the relaxed VTuber idle."""
import argparse
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation
from repair_idle_arm_axes import array, read_glb, unit, write_glb
from turn_idle_palms_inward import surface_frame


def ease(x):
    t=np.clip(x,0.,1.)
    return t*t*(3.-2.*t)


def digit_fold(points, root, direction, bend, length, angles):
    """Bend a three-phalange strip while preserving the rounded finger's local cross-section."""
    axis=unit(direction); toward=unit(bend-np.dot(bend,axis)*axis)
    side=unit(np.cross(axis,toward))
    q=points-root
    station=q@axis
    depth=q@toward
    # Integrate a smoothly changing tangent rather than translating fingertips.
    # The narrower distal joints trail the metacarpal and proximal joint.
    scale=np.linspace(0.,1.2,361)
    theta=np.deg2rad(angles) @ np.stack([ease((scale+.035)/.18),
                         ease((scale-.37)/.19),ease((scale-.69)/.16)])
    du=length*(scale[1]-scale[0])
    along=np.r_[0.,np.cumsum((np.cos(theta[1:])+np.cos(theta[:-1]))*.5*du)]
    deep=np.r_[0.,np.cumsum((np.sin(theta[1:])+np.sin(theta[:-1]))*.5*du)]
    u=station/length
    ang=np.interp(u,scale,theta)
    ca=np.interp(u,scale,along)
    cb=np.interp(u,scale,deep)
    long=np.maximum(0,station-scale[-1]*length)
    ca+=np.minimum(station,0)+long*np.cos(theta[-1]);cb+=long*np.sin(theta[-1])
    ca-=depth*np.sin(ang);cb+=depth*np.cos(ang)
    return root+ca[:,None]*axis+cb[:,None]*toward+(q@side)[:,None]*side-points


def round_digit_pads(points, station, lateral, source, roots, tips, transverse):
    """Restore the width and depth of each pad around its own curved centerline."""
    groups = np.argmin(abs(lateral[None,:] - source),axis=0)
    result = np.zeros_like(points)
    for digit, (root, tip) in enumerate(zip(roots,tips)):
        indices = np.flatnonzero(groups == digit)
        u = (station[indices] - root[0]) / (tip[0] - root[0])
        selected = u > .14
        indices, u = indices[selected], u[selected]
        if not len(indices):
            continue
        q = points[indices]
        marks = np.linspace(.19,1.,12)
        centers = []
        for mark in marks:
            ring = q[abs(u - mark) < .085]
            if len(ring) < 4:
                ring = q[np.argsort(abs(u - mark))[:12]]
            # Use surface extents: front and back atlas patches are tessellated
            # at different densities, especially toward the little fingertip.
            centers.append(np.mean(np.percentile(np.unique(np.round(ring,7),axis=0),[3.,97.],axis=0),axis=0))
        centers = np.stack(centers)
        center = np.column_stack([np.interp(u,marks,axis) for axis in centers.T])
        tangents = unit(np.gradient(centers,axis=0))
        tangent = unit(np.column_stack([np.interp(u,marks,axis) for axis in tangents.T]))
        width = unit(transverse - np.sum(tangent * transverse,axis=1)[:,None] * tangent)
        depth = np.cross(tangent,width)
        rel = q - center
        width_delta = .145*np.sum(rel*width,axis=1)
        depth_delta = .25*np.sum(rel*depth,axis=1)
        # Give each neighbouring wider pad approximately one extra texel
        # of center spacing; the middle finger remains the reference ray.
        clearance = (digit-2)*1.28/1338.91485
        strength = ease((u-.20)/.40) * (1.-.16*ease((u-.86)/.16))
        if digit == 0:
            # The radial web remains one continuous skin surface with the
            # palm. Enlarge only the independently emerging thumb pad.
            strength *= ease((u-.47)/.20)
        result[indices] = strength[:,None] * ((width_delta+clearance)[:,None]*width + depth_delta[:,None]*depth)
    return result


def rest_thumb_beside_index(points, triangles, face_digit, selected, u, axis, levels):
    """Ease the resting thumb up to the index flank at the same depth and height."""
    signed = points @ axis
    thumb = triangles[face_digit == 0]
    index = triangles[face_digit == 1]
    edge_samples = np.linspace(0, 1, 12)[None,:,None]

    def section(faces, level):
        projection = signed[faces]
        faces = faces[(projection.max(axis=1) > level) & (projection.min(axis=1) <= level)]
        edges = faces[:,[[0,1],[1,2],[2,0]]].reshape(-1,2)
        a, b = edges.T
        crossed = (signed[a] > level) != (signed[b] > level)
        a, b = a[crossed], b[crossed]
        fraction = (level - signed[a]) / (signed[b] - signed[a])
        hits = (points[a] + fraction[:,None] * (points[b] - points[a])).reshape(-1,2,3)
        segments = hits[:,1] - hits[:,0]
        return (hits[:,0,None,:] + edge_samples * segments[:,None,:]).reshape(-1,3)

    atlas_scale = 1338.91485
    displacements = []
    for level in levels:
        thumb_edge, index_edge = section(thumb,level), section(index,level)
        distances, index_neighbours = cKDTree(index_edge).query(thumb_edge)
        nearest = np.argmin(distances)
        toward = index_edge[index_neighbours[nearest]] - thumb_edge[nearest]
        # A narrow illuminated seam distinguishes the two skin surfaces.
        change = max(0., distances[nearest] - .62 / atlas_scale)
        displacements.append(unit(toward)*change)
    shifts = np.stack(displacements)
    shift = np.column_stack([np.interp(signed[selected],levels,col) for col in shifts.T])
    # Fade only at the joined skin near the thumb saddle. The rounded cap can
    # turn away from the index beyond the last fitted section.
    return shift * ease((u-.38)/.13)[:,None]


def align_thumb_with_index(points, chart, groups, roots, tips, triangles, transverse, palm):
    """Articulate the two thumb phalanges and rest the rounded pad against the index."""
    stations = np.array([.22, .30, .38, .44, .50, .58, .65, .74, .82, .88, .94, .975, .995])
    centers, parameters = [], []
    face_center = chart[triangles].mean(axis=1)
    slopes = (tips[:,1] - roots[:,1]) / (tips[:,0] - roots[:,0])
    ridges = roots[:,1,None] + (face_center[:,0] - roots[:,0,None]) * slopes[:,None]
    face_digit = np.argmin(abs(face_center[:,1] - ridges), axis=0)

    # Slice the original thumb and index rays at equal fractions of each
    # digit. Measure the center of the already relaxed and rounded surface.
    for digit in (0, 1):
        along = (chart - roots[digit]) @ unit(tips[digit] - roots[digit])
        faces = triangles[face_digit == digit]
        along /= along[faces].max()
        pairs = faces[:,[[0,1],[1,2],[2,0]]].reshape(-1,2)
        first, second = np.unique(np.sort(pairs, axis=1), axis=0).T
        centerline = []
        for station in stations:
            crossing = (along[first] > station) != (along[second] > station)
            a, b = first[crossing], second[crossing]
            fraction = (station - along[a]) / (along[b] - along[a])
            hits = points[a] + fraction[:,None] * (points[b] - points[a])
            ring = np.unique(np.round(hits, 8), axis=0)
            centerline.append(np.percentile(ring, [3,97], axis=0).mean(axis=0))
        centers.append(np.stack(centerline))
        parameters.append(along)

    thumb, index = centers
    anchor, distal_pad = 2, -3  # 38% at web exit, 94% inside the rounded tip
    # The shorter thumb has two phalanges. Its distal heading follows the
    # index, but the interphalangeal joint and the volar pad have their own form.
    index_axis = unit(index[distal_pad] - index[6])
    bend = unit(.86*palm + .35*transverse)
    bend = unit(bend - (bend @ index_axis)*index_axis)
    joint_flex = np.deg2rad(-12. + 17.*ease((stations-.58)/.20))
    tangents = np.cos(joint_flex)[:,None]*index_axis + np.sin(joint_flex)[:,None]*bend
    lengths = np.linalg.norm(np.diff(thumb,axis=0),axis=1)
    lengths *= 1.-.09*ease((stations[1:]-.64)/.26)
    path = np.cumsum(unit(tangents[1:]+tangents[:-1])*lengths[:,None],axis=0)
    target = np.vstack([np.zeros(3),path])
    target += thumb[anchor] - target[anchor]
    thumb_axis = unit(thumb[distal_pad] - thumb[anchor])
    target_axis = unit(target[distal_pad] - target[anchor])
    turn_axis = np.cross(thumb_axis, target_axis)
    rotation = unit(turn_axis) * np.arctan2(np.linalg.norm(turn_axis), thumb_axis @ target_axis)
    selected = np.flatnonzero(groups == 0)
    u = parameters[0][selected]
    def interpolate(line):
        return np.column_stack([np.interp(u, stations, coordinate) for coordinate in line.T])

    center = interpolate(thumb)
    # Start outside the index by a constant radial offset, then fit the
    # final skin-to-skin clearance after shaping the thumb pad below.
    move = interpolate(target - thumb) - 2.6 * transverse / 1338.91485
    mix = ease((u - .23) / .27)
    offset = points[selected] - center
    rotated = Rotation.from_rotvec(rotation * mix[:,None]).apply(offset)
    # A broad MCP pad narrows toward the IP crease, followed by a short,
    # softly rounded terminal pad. Retain the source relief on its surfaces.
    pose_axis = unit(interpolate(tangents))
    longitudinal = np.sum(rotated*pose_axis,axis=1)[:,None]*pose_axis
    radial = rotated-longitudinal
    pad_scale = 1.+.10*np.exp(-((u-.43)/.12)**2) - .14*ease((u-.51)/.22)
    pad_scale -= .13*ease((u-.82)/.14) + .18*ease((u-.93)/.08)
    pad_scale -= .07*np.exp(-((u-.66)/.095)**2)
    pad_scale += .025*np.exp(-((u-.79)/.10)**2)
    rotated += (mix * (pad_scale - 1.))[:,None] * radial
    # Retain the rounded terminal cap and add a slight fullness on the volar side.
    pulp = unit(palm - np.sum(pose_axis*palm,axis=1)[:,None]*pose_axis)
    volar = np.sum(radial*pulp,axis=1)
    cushion = .11*np.exp(-((u-.81)/.13)**2)*np.maximum(volar,0.)
    rotated += (mix*cushion)[:,None]*pulp
    rotated += (mix*.07*ease((u-.91)/.065))[:,None]*radial
    result = np.zeros_like(points)
    result[selected] = mix[:,None] * move + rotated - offset
    pose = points + result
    shaft = unit(index[distal_pad] - index[anchor])
    levels = np.linspace(target[3] @ shaft, target[distal_pad] @ shaft, 18)
    result[selected] += rest_thumb_beside_index(pose, triangles, face_digit, selected, u, shaft, levels)
    return result


def hand_field(doc,binary,primitive):
    attrs=primitive['attributes'];points=array(doc,binary,attrs['POSITION'])
    joint=array(doc,binary,attrs['JOINTS_0']);weights=array(doc,binary,attrs['WEIGHTS_0'])
    names=[doc['nodes'][v]['name'] for v in doc['skins'][0]['joints']]
    faces = array(doc,binary,primitive['indices']).reshape(-1,3)
    out=np.zeros_like(points)
    scale=np.array([1338.91485,-1338.91485])
    A=unit(np.array([.643,.766]));N=np.array([A[1],-A[0]])
    # MCP root and endpoint positions in the calibrated longitudinal (S) and
    # across-palm (L) coordinates. The medial short ray is the thumb.
    roots=np.array([[29,-15],[43,-8],[44,1],[43,9],[41,18]],float)
    tips=np.array([[61,-39],[88,-18],[98,3],[94,24],[78,41]],float)
    # Map transverse sections through all five centerlines, including skin in
    # the webs. The ordered intervals preserve finger order throughout the curl.
    gathered_centers=np.array([-23.6,-11.8,.7,13.2,24.5])
    distal_slopes=np.array([.008,.012,0.,-.008,-.013])
    for label,sg,offset in [('L',1,[-.40626,1.02027]),('R',-1,[-.45059,1.02075])]:
        hand=names.index('hand.'+label);fore=names.index('forearm.'+label)
        weight=(weights*(joint==hand)).sum(1)
        indices=np.flatnonzero(weight>.40);pos=points[indices].astype(float)
        _,_,dorsal,_=surface_frame(doc,binary,primitive,hand,fore,sg)
        palm=-dorsal
        xy=(pos[:,:2]-offset)*scale
        xy[:,0]=574+(xy[:,0]-574)*sg
        station=(xy-[832,806])@A;lateral=(xy-[832,806])@N
        # Use the median of the two broad palm surfaces to root all bends along
        # the local curved axes of the illustrated metacarpals.
        patch=(station>34)&(station<56)&(np.abs(lateral)<12)&(weight[indices]>.998)
        signed=pos[patch]@dorsal
        plane=.5*(np.percentile(signed,3)+np.percentile(signed,97))
        def anchor(uv):
            image=np.array([832.,806.])+uv[0]*A+uv[1]*N
            image[0]=574+sg*(image[0]-574)
            x,y=image/scale+offset
            z=(plane-dorsal[0]*x-dorsal[1]*y)/dorsal[2]
            return np.array([x,y,z])
        rr=roots.copy();tt=tips.copy()
        if sg<0:
            rr[:,1]-=1.8;tt[:,1]-=1.7;tt[:,0]-=1.6
        # Source ridges fan out progressively in the A-pose photograph.
        reference_station=np.maximum(station,32.)
        source=rr[:,1,None]+(reference_station-rr[:,0,None])*(
            (tt[:,1]-rr[:,1])/(tt[:,0]-rr[:,0]))[:,None]
        closed=gathered_centers[:,None]+distal_slopes[:,None]*(station-58.)
        if sg<0:
            closed-=1.8
        strength=ease((station-32.)/24.)
        target=source+(closed-source)*strength
        section=np.clip(np.sum(lateral[None,:]>=source,axis=0)-1,0,3)
        column=np.arange(len(pos))
        lower=source[section,column]
        upper=source[section+1,column]
        low_dest=target[section,column]
        high_dest=target[section+1,column]
        # Keep the width of the solid core of each digit. Compress the
        # changing spaces on either side while keeping a positive derivative.
        pad=np.minimum(5.0,.43*np.minimum(upper-lower,high_dest-low_dest))
        transition=np.clip((lateral-lower-pad)/(upper-lower-2*pad),0.,1.)
        shift=(1.-transition)*(low_dest-lower)+transition*(high_dest-upper)
        across=anchor([0.,1.])-anchor([0.,0.])
        gathered=pos+shift[:,None]*across

        # Cup the whole palm and bend neighboring digits in one smooth field.
        rim=np.clip(abs(lateral+2.)/33.,0.,1.)**1.45*ease((station-30.)/26.)
        gathered+=rim[:,None]*(2.3/1338.91485)*palm
        base=anchor([34.,0.])
        end=anchor([96.,0.])
        delta=gathered-pos+digit_fold(gathered,base,end-base,palm,np.linalg.norm(end-base),[20.,13.,7.])
        # The thumb metacarpal leaves the palm below the index knuckle. Restore
        # the longitudinal component lost when its original diagonal ray was
        # adducted, and aim its two phalanges toward the front of the hand.
        relaxed=pos+delta
        shaft=unit(end-base)
        transverse=unit(across-(across@shaft)*shaft)
        longitudinal=(relaxed-base)@shaft*1338.91485+34.
        cross_palm=(relaxed-base)@transverse*1338.91485
        # Taper within the radial half of the common web, in both the
        # gathered coordinates and the source chart used to label the digits.
        threshold=-15.7 - (1.8 if sg<0 else 0.)
        support=ease((threshold-cross_palm)/5.5)
        web_center=.5*(source[0]+source[1])
        support*=ease((web_center-lateral)/4.)
        reach=np.clip((longitudinal-30.)/27.,0.,1.)
        thumb_span=tt[0]-rr[0]
        extension=(np.linalg.norm(thumb_span)-thumb_span[0])*reach
        # The short thumb stays slightly forward through the MCP. Its tip
        # turns palmward at the IP joint without pointing back into the web.
        forward=10.4*ease((longitudinal-38.)/18.)
        ip_bend=8.6*ease((longitudinal-44.)/15.)
        advance=extension[:,None]*shaft-forward[:,None]*transverse+ip_bend[:,None]*palm
        delta+=support[:,None]*advance/1338.91485

        delta+=round_digit_pads(pos+delta,station,lateral,source,rr,tt,transverse)
        vertex_map = np.full(len(points), -1, dtype=int)
        vertex_map[indices] = np.arange(len(indices))
        local_faces = vertex_map[faces[(weight[faces] > .95).all(axis=1)]]
        digit = np.argmin(abs(source - lateral[None,:]), axis=0)
        chart = np.column_stack((station, lateral))
        delta += align_thumb_with_index(pos + delta, chart, digit, rr, tt, local_faces, transverse, palm)
        blend=ease((station-25.)/9.)*ease((weight[indices]-.4)/.58)
        out[indices]=(delta*blend[:,None]).astype(np.float32)
    return out


def wrist_volume_delta(doc, data):
    """Return bind-space offsets to use in the idle hand morph only."""
    skin = doc['skins'][0]
    names = [doc['nodes'][node]['name'] for node in skin['joints']]
    inverse_bind = array(doc, data, skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
    bind = np.linalg.inv(inverse_bind)
    prim = doc['meshes'][0]['primitives'][0]
    p = array(doc, data, prim['attributes']['POSITION']).astype(float)
    joints = array(doc, data, prim['attributes']['JOINTS_0'])
    weights = array(doc, data, prim['attributes']['WEIGHTS_0'])
    clip = next(a for a in doc['animations'] if a['name']=='VTuber Idle')
    delta = np.zeros_like(p)

    for name, mirror in [('L',1),('R',-1)]:
        hand = names.index('hand.'+name)
        forearm = names.index('forearm.'+name)
        wh = (weights*(joints==hand)).sum(axis=1)
        wf = (weights*(joints==forearm)).sum(axis=1)
        joint_pair = wh+wf
        take = (wh>1e-4) & (wf>1e-4) & (joint_pair>.98)
        track = next(c for c in clip['channels'] if c['target']=={'node':skin['joints'][hand],'path':'rotation'})
        sample = clip['samplers'][track['sampler']]
        hand_rotation = Rotation.from_quat(array(doc,data,sample['output'])).as_matrix()
        relative = bind[forearm,:3,:3] @ hand_rotation @ inverse_bind[hand,:3,:3]
        axis_angle = np.median(Rotation.from_matrix(relative).as_rotvec(),axis=0)
        angle = np.linalg.norm(axis_angle)
        if angle < .25:
            continue
        twist_axis = axis_angle/angle

        # Section centers are fitted independently on each wrist. Using hull
        # percentiles hides duplicated atlas edges and keeps the cuff centered.
        shaft = unit(np.array([mirror*.643,-.766,0.]))
        transverse = unit(np.array([mirror*.766,.643,0.]))
        longitudinal = p@shaft
        subset=np.unique(p[(joint_pair>.995) & (wh>.008)],axis=0)
        loc = subset@shaft
        z_band, side_band, stations = [], [], []
        for s in np.arange(longitudinal[take].min()-.01,longitudinal[take].max()+.013,.0025):
            ring = subset[abs(loc-s)<.0035]
            if len(ring)<10:
                continue
            stations.append(s)
            side_band.append(np.mean(np.percentile(ring@transverse,[3,97])))
            z_band.append(np.mean(np.percentile(ring[:,2],[3,97])))
        if len(stations)<3:
            raise ValueError('Could not locate the exposed wrist sections for '+name)
        t = longitudinal[take]
        centers = t[:,None]*shaft + np.interp(t,stations,side_band)[:,None]*transverse
        centers[:,2] = np.interp(t,stations,z_band)
        radial = p[take]-centers
        radial -= (radial@twist_axis)[:,None]*twist_axis

        # Linear blend skinning contracts the cross-section perpendicular to
        # a roll by |(1-w)+w*exp(i*angle)|. Restore most of that contraction
        # while retaining the softer silhouette near the cloth seam.
        w = wh[take]/joint_pair[take]
        scale = np.sqrt(1.-4.*w*(1.-w)*np.sin(angle/2.)**2)
        gain = .78*(1./np.maximum(scale,.65)-1.)
        delta[take] = gain[:,None]*radial
    return delta.astype('<f4')



def add_relaxed_fingers(doc,data):
    body=doc['meshes'][0]
    names=body['extras']['targetNames']
    assert len(body['primitives'])==1
    primitive=body['primitives'][0]
    fingers=hand_field(doc,data,primitive)
    delta=fingers+wrist_volume_delta(doc,data)
    existing = None
    if 'RelaxedFingers' in names:
        target = primitive['targets'][names.index('RelaxedFingers')]['POSITION']
        existing = doc['accessors'][target]
        sparse = existing['sparse']
        if existing['count'] != len(delta) or sparse['indices']['componentType'] != 5125:
            raise ValueError('Unexpected existing relaxed-finger morph layout')

        def sparse_values(field,dtype,width):
            layout=sparse[field]
            offset=doc['bufferViews'][layout['bufferView']].get('byteOffset',0)+layout.get('byteOffset',0)
            return np.frombuffer(data,dtype,count=sparse['count']*width,offset=offset).copy()
        old_ids=sparse_values('indices','<u4',1)
        old_values=sparse_values('values','<f4',3).reshape(-1,3)
        # Preserve the already fitted wrist bit-for-bit outside the digits.
        wrist_only=~(fingers[old_ids]!=0.).any(axis=1)
        delta[old_ids[wrist_only]]=old_values[wrist_only]
    vertices=np.flatnonzero((delta!=0.).any(1)).astype('<u4')
    def view(data_bytes):
        data.extend(bytes(-len(data)%4))
        idx=len(doc['bufferViews']);doc['bufferViews'].append(dict(buffer=0,byteOffset=len(data),byteLength=len(data_bytes)))
        data.extend(data_bytes);return idx
    if existing is not None:
        # Update the existing target while keeping its current clip keys.
        new_values=np.ascontiguousarray(delta[vertices],dtype='<f4').tobytes()
        for entry,blob in [('indices',vertices.tobytes()),('values',new_values)]:
            layout=sparse[entry]
            original=doc['bufferViews'][layout['bufferView']]
            offset=original.get('byteOffset',0)+layout.get('byteOffset',0)
            if original['byteLength']==len(blob) and not layout.get('byteOffset'):
                data[offset:offset+len(blob)]=blob
            else:
                layout['bufferView'] = view(blob)
                layout.pop('byteOffset',None)
        sparse['count']=len(vertices)
        existing['min']=delta.min(0).tolist()
        existing['max']=delta.max(0).tolist()
        doc['buffers'][0]['byteLength']=len(data)
        return {'affectedVertices':len(vertices),'maximumDelta':float(np.linalg.norm(delta[vertices],axis=1).max())}
    new_target=len(doc['accessors'])
    doc['accessors'].append({'componentType':5126,'type':'VEC3','count':len(delta),'min':delta.min(0).tolist(),
        'max':delta.max(0).tolist(),'sparse':{'count':len(vertices),'indices':{'componentType':5125,'bufferView':view(vertices.tobytes())},
        'values':{'bufferView':view(np.ascontiguousarray(delta[vertices],dtype='<f4').tobytes())}}})
    primitive['targets'].append({'POSITION':new_target})
    for i,node in enumerate(doc['nodes']):
        if node.get('mesh')!=0:continue
        if 'weights' in node:node['weights'].append(0.)
        for clip in doc['animations']:
            for ch in clip['channels']:
                if ch['target']!={'node':i,'path':'weights'}:continue
                sampler=clip['samplers'][ch['sampler']]
                accessor=doc['accessors'][sampler['output']]
                old=array(doc,data,sampler['output']).ravel().reshape(-1,len(names)).copy()
                value=1. if clip.get('name')=='VTuber Idle' else 0.
                out=np.ascontiguousarray(np.column_stack([old,np.full(len(old),value)]),dtype='<f4')
                accessor['count']=out.size;accessor['bufferView']=view(out.tobytes())
                accessor['min']=[float(out.min())];accessor['max']=[float(out.max())]
    body['weights'].append(0.);names.append('RelaxedFingers')
    doc['buffers'][0]['byteLength']=len(data)
    return {'affectedVertices':len(vertices),'maximumDelta':float(np.linalg.norm(delta[vertices],axis=1).max())}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();doc,data=read_glb(args.source)
    print(add_relaxed_fingers(doc,data));write_glb(args.output,doc,data)
