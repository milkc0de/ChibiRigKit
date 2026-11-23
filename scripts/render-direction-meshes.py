#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Draw the registered wireframes from a scripts/export-direction-parts.cjs ZIP."""
import argparse
import io
import json
from pathlib import Path
from zipfile import ZipFile

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1]
DIRECTIONS = [
    ('up_left', '左上'), ('up', '上'), ('up_right', '右上'),
    ('left', '左'), ('center', '正面'), ('right', '右'),
    ('down_left', '左下'), ('down', '下'), ('down_right', '右下'),
]


def mesh_lines(size, vertices, triangles, width):
    """Draw each registered edge once. OpenCV's subpixel unit is 1/16 px."""
    edges = {tuple(sorted(edge)) for a, b, c in triangles for edge in [(a, b), (b, c), (c, a)]}
    pixels = np.rint((np.asarray(vertices) - .5) * 16).astype(np.int32)
    surface = np.zeros(size[::-1], np.uint8)
    cv2.polylines(surface, [pixels[[a, b]] for a, b in sorted(edges)], False, 255,
                  width, cv2.LINE_AA, shift=4)
    return surface


def inverse_mesh(size, source, destination, triangles):
    """At every pixel center, map the posed surface back into its source triangle."""
    width, height = size
    y, x = np.indices((height, width), dtype=np.float32)
    mapping = np.stack([x, y], axis=-1)
    source, destination = np.asarray(source), np.asarray(destination)
    for indices in triangles:
        a, b, c = destination[indices]
        u, v = b-a, c-a
        area = u[0]*v[1] - u[1]*v[0]
        if area <= 0:
            raise ValueError('Folded master triangle in the exported pose')
        left, top = np.maximum([0, 0], np.floor([a, b, c]).min(axis=0)).astype(int)
        right, bottom = np.minimum(size, np.ceil([a, b, c]).max(axis=0)).astype(int)
        if right <= left or bottom <= top:
            continue
        rect = np.s_[top:bottom, left:right]
        dx, dy = x[rect] + .5 - a[0], y[rect] + .5 - a[1]
        s, t = (dx*v[1] - dy*v[0])/area, (u[0]*dy - u[1]*dx)/area
        inside = (s >= -1e-6) & (t >= -1e-6) & (s+t <= 1+1e-6)
        start, middle, end = source[indices]
        mapping[rect][inside] = (start - .5 + s[inside, None]*(middle-start)
                                 + t[inside, None]*(end-start))
    return mapping


def remap(image, coordinates):
    return cv2.remap(image, coordinates, None, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def wireframe(archive, manifest, meshes, direction):
    size = manifest['canvas']['width'], manifest['canvas']['height']
    registration = manifest['directions'][direction]['layers']
    pose = meshes['directions'][direction]
    body, head = meshes['body'], meshes['head']
    body_lines = mesh_lines(size, pose['body'], body['triangles'], 2)
    through_body = inverse_mesh(size, body['points'], pose['body'], body['triangles'])
    head_lines = remap(mesh_lines(size, pose['head'], head['triangles'], 2), through_body)
    through_head = inverse_mesh(size, head['points'], pose['head'], head['triangles'])
    through_both = remap(through_head, through_body)
    frame = np.full(size[::-1], 255, np.uint8)
    for part in manifest['drawOrder']:
        spec = manifest['parts'][part]
        if not spec['visibleInOpenPose']:
            continue
        layer = registration[part]
        x, y = layer['x'], layer['y']
        rect = np.s_[y:y+layer['height'], x:x+layer['width']]
        with Image.open(io.BytesIO(archive.read(layer['file']))) as image:
            alpha = np.asarray(image.getchannel('A'))
        # Fill each part white before drawing its grid, so higher parts occlude
        # the lower surfaces exactly as their registered PNG silhouettes do.
        intensity = body_lines[rect].astype(np.float32) * (.15 if spec['headMaster'] else .51)
        if spec['headMaster']:
            intensity = np.maximum(intensity, head_lines[rect] * .35)
        local = spec['localHeadMesh']
        if local:
            lines = mesh_lines(size, pose['localHead'][local], meshes['localHead'][local]['triangles'], 2)
            intensity = np.maximum(intensity, remap(lines, through_both[rect]) * .49)
        # Only the alpha channel contributes to the contour. Original paint
        # never enters the sheet, even at feathered or transparent edges.
        inside = cv2.erode(alpha, np.ones((5, 5), np.uint8), borderType=cv2.BORDER_CONSTANT, borderValue=0)
        intensity = np.maximum(intensity, (alpha - inside) * .96)
        opacity = alpha.astype(np.float32) / 255
        frame[rect] = np.rint((255-intensity)*opacity + frame[rect]*(1-opacity)).astype(np.uint8)
    return Image.fromarray(frame)


def label_font():
    for filename in ['/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
                     '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
                     'C:/Windows/Fonts/YuGothM.ttc']:
        if Path(filename).is_file():
            return ImageFont.truetype(filename, 22), True
    return ImageFont.load_default(size=22), False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, nargs='?', default=ROOT/'dist/milkc0de-direction-parts.zip')
    parser.add_argument('--output', type=Path, default=ROOT/'characters/milkc0de/checks/direction-meshes.png')
    args = parser.parse_args()
    with ZipFile(args.archive) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        if manifest['format'] != 'ChibiRigDirectionParts' or manifest['version'] != 1:
            raise ValueError('Unsupported direction-parts archive')
        meshes = json.loads(archive.read(manifest['topology']))
        tile_width = 460
        tile_height = round(tile_width * manifest['canvas']['height']/manifest['canvas']['width'])
        label_height, gap = 40, 12
        sheet = Image.new('L', (3*tile_width+4*gap, 3*(tile_height+label_height)+4*gap), 255)
        draw = ImageDraw.Draw(sheet)
        font, japanese = label_font()
        for i, (direction, label) in enumerate(DIRECTIONS):
            left = gap + (i%3)*(tile_width+gap)
            top = gap + (i//3)*(tile_height+label_height+gap)
            posed = wireframe(archive, manifest, meshes, direction)
            sheet.paste(posed.resize((tile_width, tile_height), Image.Resampling.LANCZOS), (left, top))
            draw.text((left+tile_width/2, top+tile_height+label_height/2),
                      label if japanese else direction.replace('_', ' ').title(), font=font, anchor='mm', fill=34)
    info = PngImagePlugin.PngInfo()
    info.add_text('playerSha256', manifest['playerSha256'])
    info.add_text('topology', manifest['topology'])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, pnginfo=info)
    print(args.output)


if __name__ == '__main__':
    main()
