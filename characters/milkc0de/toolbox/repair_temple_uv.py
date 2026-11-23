"""Reproject the forward right-temple lock to its registered frontal hair illustration."""
import argparse
from pathlib import Path
import numpy as np
from repair_idle_arm_axes import read_glb, write_glb


def repair_temple(doc, binary):
    primitive = doc['meshes'][0]['primitives'][0]
    attributes = primitive['attributes']
    dtypes = {5121:'u1', 5123:'<u2', 5125:'<u4', 5126:'<f4'}
    sizes = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}
    def raw_view(i):
        item=doc['bufferViews'][i]
        offset=item.get('byteOffset',0)
        return binary[offset:offset+item['byteLength']]
    def accessor(i):
        item=doc['accessors'][i]
        assert item.get('byteOffset',0)==0 and not doc['bufferViews'][item['bufferView']].get('byteStride')
        arr=np.frombuffer(raw_view(item['bufferView']),dtypes[item['componentType']])
        return arr.reshape(item['count'],sizes[item['type']])
    pos=accessor(attributes['POSITION'])
    uv=accessor(attributes['TEXCOORD_0'])
    triangles=accessor(primitive['indices']).reshape(-1,3).copy()
    front = pos[:,:2]*[1338.91485,-1338.91485]+[574.,1351.49214]
    landmark = front[triangles].mean(1)
    depth = pos[triangles,2].mean(1)
    donor=(uv[triangles].mean(1)*4096.-.5)
    # These coordinates are the registration and chart layout of the 14-view
    # Milkc0de asset. The true frontal eye lies below and medially to this lock.
    axial = ((donor[:,0]>=7.5)&(donor[:,0]<=484.5)&
             (donor[:,1]>=1342.5)&(donor[:,1]<=2655.5))
    x,y=landmark.T
    limit=np.interp(y,[160.,235.,310.,355.,380.,422.],[390.,411.,424.,417.,404.,386.])
    if doc['meshes'][0].get('extras',{}).get('rightTempleHairUV')==1:
        return binary, {'correctedTriangles':0,'appendedSeamVertices':0}
    zone=axial & (x>202.) & (x<limit) & (y>164.) & (y<422.) & (depth>-.073)
    edge=np.interp(y,[155,180,200,215,225,240,256,270,285,300,315,330,355,380,396,412,427],
                  [364,343,327,326,327,320,312,307,302,297,292,286,279,268,290,286,282])
    front_side=zone & ((depth>.035)&(x>edge+5.) | (donor[:,0]>359.))
    # Preserve lateral source-camera texel density where the frontal projection
    # would graze the silhouette and repeatedly sample its transparent flyaways.
    role=np.where(front_side,1,0)
    target=role!=0
    if not np.any(target):
        return binary, {'correctedTriangles':0,'appendedSeamVertices':0}
    # Retain the complete original vertex sequence, appending copies only at
    # boundaries shared by multiple source projections.
    prev=len(pos)
    shared=[]
    dest=[]
    occupied=np.zeros(prev, dtype=bool)
    for k in (0,1):
        selected=role==k
        used=np.unique(triangles[selected])
        overlap=used[occupied[used]]
        lookup=np.arange(prev,dtype=np.int64)
        extra_start=prev+sum(len(v) for v in shared)
        lookup[overlap]=np.arange(extra_start,extra_start+len(overlap))
        triangles[selected]=lookup[triangles[selected]]
        dest.append((used,lookup[used]))
        shared.append(overlap)
        occupied[used]=True
    shared=np.concatenate(shared)
    replacements={}
    # Remove the second instance of the same flower baked into the lateral
    # axial chart, keeping the original frontal daisy and its surrounding ink.
    # The sample comes from the unobstructed continuation of that very strand.
    from io import BytesIO
    from PIL import Image
    import cv2
    mat=doc['materials'][primitive['material']]
    tx=doc['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]
    imgidx=doc['images'][tx['source']]['bufferView']
    atlas=np.array(Image.open(BytesIO(raw_view(imgidx))).convert('RGB'))
    if atlas.shape != (4096,4096,3):
        raise ValueError('Expected the registered 14-view Milkc0de color atlas.')
    yy,xx=np.mgrid[1599:1702,262:361].astype(np.float32)
    radius=np.sqrt(((xx-309.)/29.)**2+((yy-1648.)/30.)**2)
    strength=np.clip((1.43-radius)/.40,0,1)
    strength=(strength*strength*(3.-2.*strength))[...,None]
    donor=cv2.remap(atlas,xx+2.,yy-68.,cv2.INTER_LINEAR)
    region=atlas[1599:1702,262:361]
    region[:]=np.rint(region*(1.-strength)+donor*strength).astype('uint8')
    png=BytesIO();Image.fromarray(atlas).save(png,format='PNG',compress_level=6)
    replacements[imgidx]=png.getvalue()
    def put(i,values):
        item=doc['accessors'][i]
        item['count']=len(values)
        if 'min' in item:
            item['min']=values.min(0).tolist()
            item['max']=values.max(0).tolist()
        replacements[item['bufferView']]=np.ascontiguousarray(values,dtype=dtypes[item['componentType']]).tobytes()
    for key,i in attributes.items():
        values=accessor(i)
        extended=np.concatenate([values,values[shared]])
        if key=='TEXCOORD_0':
            src,dst=dest[1]
            extended[dst]=(front[src]-[119.,20.]+8.5)/4096.
        put(i,extended)
    put(primitive['indices'],triangles.reshape(-1,1))
    for target_info in primitive.get('targets',[]):
        for i in target_info.values():
            item=doc['accessors'][i]
            if 'bufferView' in item:
                v=accessor(i);put(i,np.concatenate([v,v[shared]]))
                continue
            sparse=item.get('sparse')
            if sparse:
                ii=sparse['indices']; vi=sparse['values'];tp=dtypes[ii['componentType']]
                indices=np.frombuffer(raw_view(ii['bufferView']),tp)
                values=np.frombuffer(raw_view(vi['bufferView']),dtypes[item['componentType']]).reshape(len(indices),-1)
                rows=np.flatnonzero(np.isin(shared,indices))
                oldrows=np.searchsorted(indices,shared[rows])
                if len(rows):
                    newrows=np.concatenate([indices,(prev+rows).astype(tp)])
                    newvalues=np.concatenate([values,values[oldrows]])
                    replacements[ii['bufferView']]=newrows.tobytes()
                    replacements[vi['bufferView']]=newvalues.tobytes()
                    sparse['count']=len(newrows)
            item['count']+=len(shared)
    # Keep every accessor, buffer view, joint, animation and the existing vertex
    # sequence in place. The extra vertices are exact geometry/weight seam copies.
    data=bytearray()
    for i,v in enumerate(doc['bufferViews']):
        block=replacements[i] if i in replacements else raw_view(i)
        data.extend(bytes(-len(data)%4));v['byteOffset']=len(data);v['byteLength']=len(block)
        data.extend(block)
    doc['buffers'][0]['byteLength']=len(data)
    doc['meshes'][0].setdefault('extras',{})['rightTempleHairUV']=1
    return data,{'correctedTriangles':int(target.sum()),'appendedSeamVertices':len(shared)}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args()
    doc,binary=read_glb(args.source)
    binary, report=repair_temple(doc,binary)
    write_glb(args.output,doc,binary)
    print(report)
