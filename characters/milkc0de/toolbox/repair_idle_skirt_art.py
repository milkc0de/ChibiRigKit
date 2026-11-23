"""Restore the brown left skirt panel occluded by a hand in the registered side photograph."""
from io import BytesIO
from pathlib import Path
import argparse

import cv2
import numpy as np
from PIL import Image
from repair_idle_arm_axes import read_glb, write_glb


def restore_cloth(atlas):
    # The native 10-right chart starts at atlas (8,2672) for source (347,21).
    dx, dy = -339, 2651
    x0, y0, width, height = 424, 801, 164, 153
    yy, xx = np.mgrid[y0:y0 + height, x0:x0 + width].astype('f4')
    original = atlas[y0 + dy:y0 + dy + height, x0 + dx:x0 + dx + width]
    contour = np.array([[457, 817], [469, 810], [480, 815], [496, 811], [501, 833], [511, 847],
                        [555, 879], [558, 888], [553, 894], [522, 878], [553, 909], [555, 919],
                        [548, 922], [508, 890], [527, 920], [532, 932], [526, 936], [516, 928],
                        [488, 887], [496, 922], [498, 931], [491, 933], [483, 920], [462, 866],
                        [457, 878], [449, 887], [438, 881], [437, 871], [439, 850], [441, 837],
                        [452, 824]])
    rough = np.zeros((height, width), 'u1')
    cv2.fillPoly(rough, [(contour - [x0, y0]).astype('i')], 255)
    ellipse = lambda size: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    red, green, blue = original.astype(int).transpose(2, 0, 1)
    inside = (cv2.dilate(rough, ellipse(17)) > 0) & (red > 190) & (green > 131) & (blue > 113) & (
        red - green < 95) & (green - blue < 48)
    _, labels = cv2.connectedComponents(inside.astype('u1'))
    palm = labels[851 - y0, 470 - x0]
    if palm == 0: raise ValueError('The registered palm landmark is missing from the source chart')
    shape = cv2.morphologyEx((labels == palm).astype('u1') * 255, cv2.MORPH_CLOSE, ellipse(3))
    full = cv2.dilate(shape, ellipse(9))
    edge = np.clip(1. - cv2.distanceTransform(255 - full, cv2.DIST_L2, cv2.DIST_MASK_PRECISE) / 5.,
                   0, 1)
    alpha = (edge * edge * (3. - 2. * edge))[:, :, None]
    # The brown central panel has unobstructed painted fabric. Register the
    # cream/gold trim by the measured hem line in each of the two source views.
    # Near the hem use its actual lateral continuation and preserve unoccluded ink.
    front_x = 518. + .55 * (xx - 440.)
    front_hem = np.interp(front_x, [500, 520, 535, 555, 570, 585, 597],
                          [939, 939, 942, 946, 948, 947, 946])
    side_hem = np.interp(xx, [434, 480, 495, 514, 540, 550, 561, 567, 576, 581, 588],
                         [968, 966, 962, 954, 952, 949, 945, 943, 940, 938, 937])
    central = cv2.remap(atlas, (front_x - 111).astype('f4'),
                        (yy + front_hem - side_hem - 12).astype('f4'),
                        cv2.INTER_LINEAR).astype(float)
    central += np.array([6., 1., 0.])
    hem_x = 562. + .205 * (xx - 440.)
    hem_height = np.interp(hem_x, [550, 561, 567, 576, 581, 588, 598],
                           [949, 945, 943, 940, 938, 937, 935])
    hem = cv2.remap(atlas, (hem_x + dx).astype('f4'),
                    (yy + hem_height - side_hem + dy).astype('f4'), cv2.INTER_LINEAR)
    mix = np.clip((yy - side_hem + 31.) / 13., 0, 1)
    mix = (mix * mix * (3. - 2. * mix))[:, :, None]
    donor = np.uint8(np.clip(central * (1. - mix) + hem * mix, 0, 255))
    result = np.rint(original * (1. - alpha) + donor * alpha).astype('u1')
    return result, (x0 + dx, y0 + dy)


def registered_arrays(doc, data):
    types = {
        5121: 'u1',
        5123: '<u2',
        5125: '<u4',
        5126: '<f4'
    }
    widths = {
        'SCALAR': 1,
        'VEC2': 2,
        'VEC3': 3,
        'VEC4': 4
    }

    def raw(i):
        v = doc['bufferViews'][i]
        o = v.get('byteOffset', 0)
        return data[o:o + v['byteLength']]

    def values(i):
        a = doc['accessors'][i]
        v = doc['bufferViews'][a['bufferView']]
        if a.get('byteOffset', 0) or v.get('byteStride'):
            raise ValueError('Expected registered dense attribute arrays')
        return np.frombuffer(raw(a['bufferView']),
                             types[a['componentType']]).reshape(a['count'], widths[a['type']])

    return raw, values, types, widths


def move_registered_faces(doc, data, selected, offset, blocks=None):
    """Move only receiving triangles, duplicating shared UV seams and their animated attributes."""
    prim, = doc['meshes'][0]['primitives']
    attrs = prim['attributes']
    raw, values, types, widths = registered_arrays(doc, data)
    pos = values(attrs['POSITION'])
    indices = values(prim['indices']).reshape(-1, 3).copy()
    affected = np.unique(indices[selected])
    shared = np.intersect1d(affected, np.unique(indices[~selected]))
    blocks = {} if blocks is None else blocks
    mapping = np.arange(len(pos))
    mapping[shared] = np.arange(len(pos), len(pos) + len(shared))
    indices[selected] = mapping[indices[selected]]

    def replace(i, v):
        a = doc['accessors'][i]
        a['count'] = len(v)
        if 'min' in a:
            a['min'] = v.min(0).tolist()
            a['max'] = v.max(0).tolist()
        blocks[a['bufferView']] = np.ascontiguousarray(v, dtype=types[a['componentType']]).tobytes()

    for n, i in attrs.items():
        a = values(i)
        extended = np.concatenate([a, a[shared]])
        if n == 'TEXCOORD_0': extended[mapping[affected]] = a[affected] + offset
        replace(i, extended)
    replace(prim['indices'], indices.reshape(-1, 1))
    for morph in prim.get('targets', []):
        for i in morph.values():
            a = doc['accessors'][i]
            if 'bufferView' in a:
                v = values(i)
                replace(i, np.concatenate([v, v[shared]]))
                continue
            sparse = a.get('sparse')
            if sparse:
                ids = sparse['indices']
                val = sparse['values']
                original = np.frombuffer(raw(ids['bufferView']), types[ids['componentType']])
                arr = np.frombuffer(raw(val['bufferView']), types[a['componentType']]).reshape(
                    sparse['count'], widths[a['type']])
                _, extra, rows = np.intersect1d(shared, original, return_indices=True)
                if len(extra):
                    blocks[ids['bufferView']] = np.r_[original,
                                                      (len(pos) +
                                                       extra).astype(original.dtype)].tobytes()
                    blocks[val['bufferView']] = np.concatenate([arr, arr[rows]]).tobytes()
                    sparse['count'] += len(extra)
            a['count'] += len(shared)
    rebuilt = bytearray()
    for i, view in enumerate(doc['bufferViews']):
        old = raw(i) if i not in blocks else blocks[i]
        rebuilt.extend(bytes(-len(rebuilt) % 4))
        view['byteOffset'] = len(rebuilt)
        view['byteLength'] = len(old)
        rebuilt.extend(old)
    doc['buffers'][0]['byteLength'] = len(rebuilt)
    return rebuilt, len(shared)


def repair_idle_skirt_art(doc, data):
    body = doc['meshes'][0]
    if body.get('extras', {}).get('leftSkirtHandPhotoRepair') == 1:
        return data, {'alreadyApplied': True}
    prim, = body['primitives']
    attrs = prim['attributes']
    raw, values, _, _ = registered_arrays(doc, data)
    pos = values(attrs['POSITION'])
    tex = values(attrs['TEXCOORD_0'])
    indices = values(prim['indices']).reshape(-1, 3).copy()
    uv = tex * 4096. - .5
    sample = uv[indices].mean(1)
    side = sample - [-339, 2651]
    names = [doc['nodes'][i]['name'] for i in doc['skins'][0]['joints']]
    j = values(attrs['JOINTS_0'])
    w = values(attrs['WEIGHTS_0'])

    def influence(rule):
        return (np.isin(j, [i for i, n in enumerate(names) if rule(n)]) * w).sum(1)[indices].mean(1)

    garment = influence(lambda n: n.startswith('skirt.') or n in ('hips', 'spine', 'chest'))
    arm = influence(lambda n: n.startswith(('upper_arm.', 'forearm.', 'hand.')))
    hull = np.array([[435, 811], [503, 805], [524, 840], [567, 874], [572, 905], [542, 941],
                     [479, 941], [465, 915], [430, 888]], 'i')
    xmin, ymin = 415, 792
    region = np.zeros((168, 175), 'u1')
    cv2.fillPoly(region, [hull - [xmin, ymin]], 255)
    dist = cv2.distanceTransform(255 - region, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    side_pixel = np.rint(side - [xmin, ymin]).astype(int)
    near = (side_pixel >= 0).all(1) & (side_pixel < [region.shape[1], region.shape[0]]).all(1)
    selected = np.zeros(len(indices), bool)
    selected[near] = dist[side_pixel[near, 1], side_pixel[near, 0]] < 7
    centers = pos[indices].mean(1)
    selected &= (garment > .5) & (arm < .10) & (centers[:, 0] > .105) & (centers[:, 0] < .24) & (
        centers[:, 1] > .25) & (centers[:, 1] < .45)
    # Three slivers on the welded outer garment edge were classified as hair
    # in the source's authored part mesh. Keep their original artwork intact.
    edge_faces = [145920, 150512, 153199]
    if len(indices) <= max(edge_faces):
        raise ValueError('This pass requires the registered 14-view body mesh')
    selected[edge_faces] = False
    if selected.sum() != 783:
        raise ValueError(f'Expected 783 registered skirt triangles, got {selected.sum()}')
    material = doc['materials'][prim['material']]
    texture = doc['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]
    img = doc['images'][texture['source']]['bufferView']
    atlas = np.array(Image.open(BytesIO(raw(img))).convert('RGB'))
    if atlas.shape != (4096, 4096, 3): raise ValueError('Expected the registered 4K atlas')
    affected = np.unique(indices[selected])
    # Keep all original texels and faces intact outside the skirt. Put a private
    # copy of its chart in unused atlas space, with four filtering guard pixels.
    low = np.floor(uv[affected].min(0)).astype(int) - 4
    high = np.ceil(uv[affected].max(0)).astype(int) + 5
    width, height = high - low
    new = np.array([1660, 1050])
    end = new + [width, height]
    old_bounds = uv[indices]
    overlap = (old_bounds.max(1) >= new - 2).all(1) & (old_bounds.min(1) < end + 2).all(1)
    if overlap.any() or not (atlas[new[1]:end[1], new[0]:end[0]] == 128).all():
        raise ValueError('Skirt island reserve is already occupied')
    island = atlas[low[1]:high[1], low[0]:high[0]].copy()
    painted, start = restore_cloth(atlas)
    start = np.array(start)
    stop = start + [painted.shape[1], painted.shape[0]]
    lo = np.maximum(start, low)
    hi = np.minimum(stop, high)
    island[lo[1] - low[1]:hi[1] - low[1],
           lo[0] - low[0]:hi[0] - low[0]] = painted[lo[1] - start[1]:hi[1] - start[1],
                                                    lo[0] - start[0]:hi[0] - start[0]]
    atlas[new[1]:end[1], new[0]:end[0]] = island
    buf = BytesIO()
    Image.fromarray(atlas).save(buf, format='PNG', compress_level=6)
    rebuilt, seam_count = move_registered_faces(doc, data, selected, (new - low) / 4096., {img: buf.getvalue()})
    body.setdefault('extras', {})['leftSkirtHandPhotoRepair'] = 1
    return rebuilt, {
        'faces': int(selected.sum()),
        'seamVertices': seam_count,
        'atlasOrigin': new.tolist(),
        'islandSize': [int(width), int(height)]
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    doc, data = read_glb(args.source)
    data, report = repair_idle_skirt_art(doc, data)
    write_glb(args.output, doc, data)
    print(report)
