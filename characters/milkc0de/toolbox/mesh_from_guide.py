"""Register the neutral wire drawing to the painted character and triangulate it."""
import cv2
import numpy as np
from PIL import Image


def register_landmarks(guide_image, correspondences):
    # Fit a thin-plate spline through painted landmarks. The guide and the
    # painting have different head proportions and asymmetrical limb lengths.
    ties = np.asarray(list(correspondences.values()), dtype=float)
    scale = max(guide_image.size)
    src, dest = ties[:, 0] / scale, ties[:, 1]

    def basis(points):
        r2 = ((points[:, None] - src[None, :]) ** 2).sum(axis=2)
        return r2 * np.log(np.maximum(r2, 1e-12))

    axes = np.column_stack([np.ones(len(src)), src])
    system = np.block([[basis(src), axes], [axes.T, np.zeros((3, 3))]])
    weights = np.linalg.solve(system, np.vstack([dest, np.zeros((3, 2))]))
    corners = cv2.goodFeaturesToTrack(np.asarray(guide_image), 280, .012, 10)
    if corners is None:
        raise ValueError('No wire intersections in the neutral guide')
    points = corners[:, 0] / scale
    mapped = np.column_stack([basis(points), np.ones(len(points)), points]) @ weights
    return [tuple(map(int, point)) for point in np.rint(np.vstack([dest, mapped]))]


def triangulate(bounds, anchors, support, minimum_spacing):
    left, top, right, bottom = bounds
    points = set(support)
    for x, y in anchors:
        if not left < x < right or not top < y < bottom:
            continue
        if all((x-px)**2 + (y-py)**2 >= minimum_spacing**2 for px, py in points):
            points.add((x, y))
    points = sorted(points, key=lambda p: (p[1], p[0]))
    # Padding the construction rectangle leaves collinear points on the
    # original canvas edges available to the triangulation.
    extent = 4 * max(right, bottom)
    subdiv = cv2.Subdiv2D((-extent, -extent, 3*extent, 3*extent))
    for p in points:
        subdiv.insert(p)
    indices = {p: i for i, p in enumerate(points)}
    triangles = []
    for coordinates in subdiv.getTriangleList().reshape(-1, 3, 2):
        a, b, c = [tuple(map(int, p)) for p in np.rint(coordinates)]
        if a not in indices or b not in indices or c not in indices:
            continue
        if (b[0]-a[0])*(c[1]-a[1]) < (b[1]-a[1])*(c[0]-a[0]):
            b, c = c, b
        triangles.append([indices[a], indices[b], indices[c]])
    return {'points': [list(p) for p in points], 'triangles': sorted(triangles)}


def build_turn_meshes(root, profile, canvas, pivot):
    guide = profile['mesh_guide']
    x, y, w, h = guide['neutral_cell']
    with Image.open(root / guide['file']) as sheet:
        cell = sheet.convert('L').crop((x, y, x+w, y+h))
    anchors = register_landmarks(cell, guide['registration'])

    left, top, right, bottom = guide['head_domain']
    head_x = sorted({*map(round, np.linspace(left, right, 15)), round(pivot['x'])})
    head_y = sorted({*map(round, np.linspace(top, bottom, 17)), round(pivot['y'])})
    head = triangulate(guide['head_domain'], anchors,
                       [(x, y) for y in head_y for x in head_x], 14)

    width, height = canvas['width'], canvas['height']
    body = profile['body_turn']
    columns = [0, body['center_x']-body['half_width'], body['center_x'],
               body['center_x']+body['half_width'], width]
    rows = [0, round(body['rows'][0]['y']/3), *(row['y'] for row in body['rows']), height]
    # Constrain strip boundaries and the center line. A triangle straddling
    # the ankle strip would move planted shoe pixels with its shin vertex.
    # Head detail is already carried by the separate neck surface.
    body_anchors = [(x,y) for x,y in anchors if y >= body['rows'][0]['y']-50]
    point_ids, triangles = {}, []
    for y0, y1 in zip(rows, rows[1:]):
        for x0, x1 in zip(columns, columns[1:]):
            border = {(x, y) for x in [x0, x1] for y in [y0, y1]}
            if y1 >= body['rows'][0]['y']:
                border.update((x, y) for x in [x0, x1] for y in range(y0, y1, 74))
            for x in range(x0, x1, 82):
                border.update([(x,y0), (x,y1)])
            tile = triangulate((x0,y0,x1,y1), body_anchors, border, 17)
            ids = [point_ids.setdefault(tuple(p), len(point_ids)) for p in tile['points']]
            triangles.extend([[ids[i] for i in triangle] for triangle in tile['triangles']])
    return head, {'points': [list(p) for p in point_ids], 'triangles': triangles}
