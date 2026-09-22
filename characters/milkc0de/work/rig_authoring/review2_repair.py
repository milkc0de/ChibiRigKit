# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Second review: source-colored strands incorrectly retained in the base.
Run after review1_repair.py. Corrections are restricted to two reviewed regions.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[2]
plan = json.loads((root/'rig.plan.json').read_text())
parts = {p['id']:p for p in plan['parts']}
source = np.array(Image.open(root/'work/aligned/normal.png').convert('RGBA'))
H,W = source.shape[:2]
def load(path): return np.array(Image.open(root/path))>0
def save(path,m): Image.fromarray(m.astype('uint8')*255,'L').save(root/path)
background = load(parts['background']['mask'])
regions = {'hair_back_left':(210,700,280,767), 'hair_side_left':(225,440,275,535)}
counts = {}
for name,(x0,y0,x1,y1) in regions.items():
    path = f'work/masks/review2_{name}_correction.png'
    original = load(path) if (root/path).exists() else np.zeros((H,W),bool)
    background |= original
    save(parts[name]['mask'],load(parts[name]['mask']) & ~original)
    region = np.zeros((H,W),bool);region[y0:y1,x0:x1] = True
    if name == 'hair_side_left':
        # Follow the observed left edge of this lock; shaded cafe beyond it
        # shares some brown values and must remain stationary.
        edge = np.interp(np.arange(H),[440,470,480,490,500,510,520,530,535],
                         [225,231,234,235,238,242,247,252,254])
        region &= np.arange(W)[None,:] >= edge[:,None]
    # In these source-inspected windows, the cafe openings are pale cream.
    brown = (source[:,:,0]<210)&(source[:,:,1]<175)&(source[:,:,2]<150)
    correction = region & brown & background
    save(path,correction)
    save(parts[name]['mask'],load(parts[name]['mask']) | correction)
    if repair := parts[name].get('texture_repair'):
        save(repair['mask'],load(repair['mask']) & ~correction)
    background &= ~correction
    counts[name] = int(correction.sum())
save(parts['background']['mask'],background)
character = ~background
save(parts['background_hidden_margin']['mask'],character)
save('work/rig_authoring/character_silhouette.png',character)
_,labels = cv2.distanceTransformWithLabels(character.astype('uint8'),cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
yy,xx = np.where(background)
lut = np.zeros((len(yy)+1,2),np.int32);lut[labels[yy,xx]] = np.column_stack([yy,xx])
nearest = lut[labels]
patch = source.copy();patch[character,:3] = source[nearest[:,:,0][character],nearest[:,:,1][character],:3]
patch[background,3] = 0
Image.fromarray(patch).save(root/parts['background_hidden_margin']['texture_repair']['file'])
(root/'checks/review2-repairs.json').write_text(json.dumps({'transferred_source_pixels':counts,'method':'Source pixels transferred from static background into existing hair masks inside two explicit reviewed regions; RGB unchanged.'},indent=2)+'\n')
print(json.dumps(counts))
