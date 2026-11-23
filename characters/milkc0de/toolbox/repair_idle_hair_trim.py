"""Remove the skirt hem projected onto the swinging hair beside both thumbs."""
import argparse
import hashlib
from pathlib import Path

import numpy as np
from repair_idle_arm_axes import read_glb, write_glb
from repair_idle_skirt_art import move_registered_faces, registered_arrays

# These faces were back-projected from stray pale strips at 4.9 s and 46 s. All belong
# to the original hair surface, including the cells skinned partly to the skirt.
RECEIVERS = np.array([
    27329, 27330, 27335, 27336, 28877, 28878, 28883, 28884, 28885,
    30483, 30484, 30489, 30490, 30491, 30492, 32092, 32093, 32100,
    32101, 32102, 32103, 33642, 33643, 33644, 33645, 33650, 33651,
    33652, 33653, 33656, 33657, 35140, 35144, 35160, 35161, 35166,
    35167, 36637, 36638, 36644, 38062, 38078,
    145918, 145940, 147457, 147458, 147472, 148976, 148986, 148987, 150508,
    150509, 150510, 150522, 150523, 150524, 150525, 150532, 150533, 151964,
    151965, 151970, 151971, 151972, 151973, 151980, 153228, 153229, 153234,
    153235, 153236, 153237, 154486, 154487, 154488, 155752, 155753,
])


def repair_idle_hair_trim(doc, data):
    body = doc['meshes'][0]
    if body.get('extras', {}).get('hairHemProjectionRepair') == 1:
        return data, {'alreadyApplied': True}
    _, values, _, _ = registered_arrays(doc, data)
    prim, = body['primitives']
    triangles = values(prim['indices']).reshape(-1, 3)
    corners = triangles[RECEIVERS]
    uv = values(prim['attributes']['TEXCOORD_0'])[corners]
    pos = values(prim['attributes']['POSITION'])[corners]
    if hashlib.sha256(np.dstack((pos, uv)).tobytes()).hexdigest() != '67b75df2104495e6bd324be5d44a7689f5174b5fca877b01acd5dede7f612c8b':
        raise ValueError('Expected the intact registered hair edges in the 14-view mesh')

    # Front photograph origin (-111,-12); the isolated posterior hair chart
    # uses the same pixel coordinates with origin (2761,548) in the 4K atlas.
    selected = np.zeros(len(triangles), dtype=bool)
    selected[RECEIVERS] = True
    data, seams = move_registered_faces(doc, data, selected, np.array([2872., 560.]) / 4096.)
    body.setdefault('extras', {})['hairHemProjectionRepair'] = 1
    return data, {'hairFaces': len(RECEIVERS), 'seamVertices': seams}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    doc, data = read_glb(args.source)
    data, report = repair_idle_hair_trim(doc, data)
    write_glb(args.output, doc, data)
    print(report)
