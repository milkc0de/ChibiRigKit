# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Transfer observed stationary curl fragments to their existing moving locks.

Only normal-source pixels inside explicitly traced correction masks are added.
Run after create_rig.py if regenerating the original decomposition.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
plan = json.loads((ROOT / 'rig.plan.json').read_text())
parts = {p['id']: p for p in plan['parts']}
source = np.array(Image.open(ROOT / 'work/aligned/normal.png').convert('RGBA'))
H, W = source.shape[:2]

def read(name):
    return np.array(Image.open(ROOT / parts[name]['mask'])) > 0

def save(path, mask):
    Image.fromarray(mask.astype('uint8') * 255, 'L').save(ROOT / path)

regions = {
    'hair_side_left': [
        [(210,465),(227,438),(237,414),(247,393),(259,375),(257,402),(244,431),(230,456),(220,477),(215,497),(214,516),(218,530),(228,539),(241,543),(249,540),(245,545),(232,547),(221,542),(211,534),(204,522),(202,509),(202,494),(205,479)],
        [(235,459),(248,455),(248,477),(250,498),(258,513),(269,527),(271,536),(260,527),(247,512),(240,496)],
    ],
    'hair_back_right': [
        [(839,932),(833,945),(830,960),(832,976),(838,986),(850,997),(865,1004),(881,1005),(892,1000),(899,992),(902,982),(900,974),(897,970),(898,979),(894,986),(885,990),(873,989),(862,983),(859,976),(861,967),(868,959),(879,952),(893,947),(913,944),(900,935)],
        [(794,948),(809,954),(818,958),(829,958),(830,967),(820,970),(807,970),(796,966)],
    ],
}
background = read('background')
# Undo this script's previous correction before applying a revised trace.
for name in regions:
    previous_path = ROOT / f'work/masks/review1_{name}_correction.png'
    if previous_path.exists():
        previous = np.array(Image.open(previous_path)) > 0
        save(parts[name]['mask'], read(name) & ~previous)
        background |= previous
added = np.zeros((H,W), bool)
counts = {}
for name, polygons in regions.items():
    image = Image.new('L', (W,H))
    draw = ImageDraw.Draw(image)
    for polygon in polygons:
        draw.polygon(polygon, fill=255)
    # Source-color boundary guard excludes the bright cafe seen through loops.
    correction = (np.array(image)>0) & background & (source[:,:,1]<190) & (source[:,:,2]<165)
    save(f'work/masks/review1_{name}_correction.png', correction)
    save(parts[name]['mask'], read(name) | correction)
    repair = parts[name].get('texture_repair')
    if repair:
        original_repair = np.array(Image.open(ROOT / repair['mask'])) > 0
        save(repair['mask'], original_repair & ~correction)
    background &= ~correction
    added |= correction
    counts[name] = int(correction.sum())

save(parts['background']['mask'], background)
character = ~background
save(parts['background_hidden_margin']['mask'], character)
save('work/rig_authoring/character_silhouette.png', character)
# Recompute hidden backdrop from stationary pixels after removing curl remnants.
_, labels = cv2.distanceTransformWithLabels(character.astype('uint8'), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
yy, xx = np.where(background)
lut = np.zeros((len(yy)+1,2), dtype=np.int32)
lut[labels[yy,xx]] = np.column_stack([yy,xx])
nearest = lut[labels]
patch = source.copy()
patch[character,:3] = source[nearest[:,:,0][character],nearest[:,:,1][character],:3]
patch[background,3] = 0
Image.fromarray(patch).save(ROOT / parts['background_hidden_margin']['texture_repair']['file'])
(ROOT / 'checks/review1-repairs.json').write_text(json.dumps({'transferred_source_pixels':counts,'scope':'Explicit correction masks only; original RGB copied unchanged; no new parts or pose changes.'}, indent=2)+'\n')
print(json.dumps(counts))
