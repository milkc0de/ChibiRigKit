"""Round the exposed idle wrist and restore the ruffle underside behind each hand."""
import argparse
import hashlib
from pathlib import Path

import numpy as np

from repair_idle_arm_axes import read_glb, write_glb
from repair_idle_skirt_art import move_registered_faces, registered_arrays


# Rear closure faces identified in the registered 14-view costume. Their UVs
# projected the foreground wrist onto the inside of the sleeve under a bent arm.
CUFF_FACES = {
    'L': (
        194602, 194603, 194629, 194630, 194641, 194642, 194643, 194721,
        194738, 194739, 194740, 194920, 194921, 194922, 194923, 194924,
        194925, 194926, 194969, 194970, 195173, 195174, 195175, 195176,
        195177, 195178, 195179, 195180, 195181, 195182, 195183, 195184,
        195185, 195186, 195194, 195195, 195196, 195197, 195198, 195202,
        195209, 195210, 195371, 195372, 195373, 195374, 195455, 195456,
        195457, 195460, 195461, 195462, 195463, 195464, 195465,
    ),
    'R': (
        192808, 192909, 192910, 192911, 192951, 192952, 192995, 192996,
        192998, 192999, 193000, 193001, 193002, 193158, 193159, 193177,
        193178, 193182, 193271, 193272, 193273, 193274, 193275, 193276,
        193277, 193285, 193287, 193288, 193289, 193380, 193381, 193382,
        193383, 193384, 193385, 193386, 193394, 193395, 193396, 193397,
        193398, 193447, 193448, 193450, 193558, 193559, 193560, 193561,
        193562, 193626, 193627, 193628, 193631,
    ),
}
FACE_HASH = {
    'L': '5b7b73fe5d80b5234950a97327bcd135ccf7485750c6a5dc1efc563c4f01caec',
    'R': 'fef36a7cc449510d890b3b55a57a77ed1ef271a80718ae34c76224599057fd6f',
}


def smoothstep(value):
    value = np.clip(value, 0., 1.)
    return value * value * (3. - 2. * value)


def restore_wrist_envelopes(doc, data):
    mesh = doc['meshes'][0]
    prim, = mesh['primitives']
    attrs = prim['attributes']
    _, values, types, _ = registered_arrays(doc, data)
    target = mesh['extras']['targetNames'].index('RelaxedFingers')
    accessor = doc['accessors'][prim['targets'][target]['POSITION']]
    sparse = accessor['sparse']

    def sparse_values(entry, width, dtype):
        layout = sparse[entry]
        view = doc['bufferViews'][layout['bufferView']]
        offset = view.get('byteOffset', 0) + layout.get('byteOffset', 0)
        return np.frombuffer(data, dtype, count=sparse['count'] * width,
                             offset=offset).reshape(-1, width)

    row = sparse_values('indices', 1, types[sparse['indices']['componentType']]).ravel()
    delta = sparse_values('values', 3, types[accessor['componentType']])
    positions = values(attrs['POSITION'])[row].astype(float)
    joints = values(attrs['JOINTS_0'])[row]
    weights = values(attrs['WEIGHTS_0'])[row]
    names = [doc['nodes'][n]['name'] for n in doc['skins'][0]['joints']]
    scale = 1338.91485
    longitudinal = np.array([.643, .766])
    longitudinal /= np.linalg.norm(longitudinal)
    transverse = np.array([longitudinal[1], -longitudinal[0]])
    count = 0
    for side, sign, origin in (('L', 1, [-.40626, 1.02027]), ('R', -1, [-.45059, 1.02075])):
        hand = ((joints == names.index('hand.' + side)) * weights).sum(1)
        forearm = ((joints == names.index('forearm.' + side)) * weights).sum(1)
        xy = (positions[:, :2] - origin) * [scale, -scale]
        xy[:, 0] = 574 + sign * (xy[:, 0] - 574)
        station = (xy - [832, 806]) @ longitudinal
        lateral = (xy - [832, 806]) @ transverse
        # The old wrist cuff is cut at station 17.35. Its rear surface still
        # follows the depth of the original visual hull. Retract it smoothly
        # before the vertices of the rebuilt palm at station 32.55.
        envelope = ((hand + forearm > .985) * smoothstep((hand - .22) / .27)
                    * smoothstep((station + 12.) / 19.) * smoothstep((26. - station) / 8.6)
                    * smoothstep((lateral + 38.) / 14.) * smoothstep((12. - lateral) / 14.))
        lift = np.clip(85. - positions[:, 2] * scale, 0., 32.) * envelope * .88
        delta[:, 2] += (lift / scale).astype('<f4')
        count += np.count_nonzero(lift)
    # The other sparse rows are zero. Keep glTF bounds in sync after shaping.
    accessor['min'] = np.minimum(0., delta.min(0)).tolist()
    accessor['max'] = np.maximum(0., delta.max(0)).tolist()
    return int(count)


def repair_idle_wrist_cuffs(doc, data):
    mesh = doc['meshes'][0]
    if mesh.get('extras', {}).get('idleWristCuffRepair') == 1:
        return data, {'alreadyApplied': True}
    prim, = mesh['primitives']
    _, values, _, _ = registered_arrays(doc, data)
    triangles = values(prim['indices']).reshape(-1, 3)
    pos = values(prim['attributes']['POSITION'])
    uv = values(prim['attributes']['TEXCOORD_0'])
    for side, faces in CUFF_FACES.items():
        corners = triangles[list(faces)]
        guard = hashlib.sha256(np.dstack((pos[corners], uv[corners])).tobytes()).hexdigest()
        if guard != FACE_HASH[side]:
            raise ValueError('Expected the registered rear sleeve closure on side ' + side)
    adjusted = restore_wrist_envelopes(doc, data)
    seam_count = 0
    for side, sign, donor_center in (('L', 1, 807.), ('R', -1, 343.)):
        _, values, _, _ = registered_arrays(doc, data)
        triangles = values(prim['indices']).reshape(-1, 3)
        selected = np.zeros(len(triangles), dtype=bool)
        selected[list(CUFF_FACES[side])] = True
        indices = np.unique(triangles[selected])
        original = values(prim['attributes']['TEXCOORD_0'])[indices] * 4096. - .5 + [111, 12]
        # This narrow slope follows the ruffle's shaded inner fold in the same
        # original illustration. The front of the sleeve and true skin retain their UVs.
        dx = (original[:, 0] - (824. if side == 'L' else 324.)) * .22
        donor = np.c_[donor_center + dx, 825. - .42 * sign * dx + .085 * (original[:, 1] - 809.)]
        data, duplicates = move_registered_faces(doc, data, selected, (donor - original) / 4096.)
        seam_count += duplicates
    mesh.setdefault('extras', {})['idleWristCuffRepair'] = 1
    return data, {'wristVertices': adjusted, 'cuffFaces': sum(map(len, CUFF_FACES.values())),
                  'seamVertices': seam_count}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    doc, data = read_glb(args.source)
    data, report = repair_idle_wrist_cuffs(doc, data)
    write_glb(args.output, doc, data)
    print(report)
