# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Shared build/validation contract. Coordinates are in the registered canvas."""
import hashlib
import json
import re
import math
from jsonschema import Draft202012Validator
from pathlib import Path
from player_output import preview_path

KINDS = {'eye_sclera','eye_iris','eye_line','normal', 'static', 'eye_open', 'drawn_eye_closed', 'eye_closed',
         'mouth_open', 'mouth_closed', 'mouth_smile', 'blush', 'brow'}
MESHES = {'face_grid','blink_eye_radial', 'blink_eye_grid', 'blink_eye_curve',
          'blink_eye', 'bend_vertical', 'bend_strip', 'soft_body', 'soft_strip',
          'mouth_open_close'}


def local_path(root, value):
    path = (root / value).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f'Path escapes workspace: {value}')
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot(root):
    return {str(p.relative_to(root)): digest(p)
            for folder in ('input', 'work/aligned')
            for p in sorted((root / folder).rglob('*')) if p.is_file()}


def verify_sources(root):
    manifest = root / 'work/source_hashes.json'
    if not manifest.exists():
        raise ValueError('Run toolbox/normalize_inputs.py first (source hashes missing)')
    if json.loads(manifest.read_text()) != snapshot(root):
        raise ValueError('Immutable input/aligned images changed; review sources and normalize again')


def validate_plan(root, plan):
    schema = json.loads((root/'rig.plan.schema.json').read_text())
    Draft202012Validator(schema).validate(plan)
    def finite(value):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError('NaN/Infinity are invalid rig parameters')
        if isinstance(value, dict):
            for child in value.values():finite(child)
        if isinstance(value, list):
            for child in value:finite(child)
    finite(plan)
    specs = plan.get('parts', [])
    ids = [p['id'] for p in specs]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('Part IDs must be nonempty and unique')
    if len({pid.casefold() for pid in ids}) != len(ids):
        raise ValueError('Part IDs must also be unique on case-insensitive filesystems')
    if any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', pid) for pid in ids):
        raise ValueError('Part IDs must be safe filenames (letters, digits, _, -, .)')
    order = plan.get('draw_order', [])
    if len(order) != len(ids) or set(order) != set(ids):
        raise ValueError('draw_order must contain every part exactly once')
    if fill := plan.get('neck_fill'):
        local_path(root,fill['file'])
        for key in ('head_edge','body_edge'):
            edge=fill.get(key)
            if not isinstance(edge,list) or len(edge)!=2 or any(not isinstance(p,list) or len(p)!=2 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in p) for p in edge):raise ValueError(f'neck_fill.{key}: two canvas points required')
        rect=fill.get('skin_rect')
        if not isinstance(rect,list) or len(rect)!=4 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in rect) or min(rect[:2])<0 or min(rect[2:])<=0:raise ValueError('neck_fill.skin_rect: positive opaque source rectangle required')
        if fill.get('body_part') not in ids:raise ValueError('neck_fill.body_part must reference the body attachment part')
    groups = plan.get('groups', {})
    parts = {p['id']: p for p in specs}
    for name, group in groups.items():
        if not isinstance(group.get('pivot'), dict) or not {'x', 'y'} <= group['pivot'].keys():
            raise ValueError(f'{name}: group pivot needs x/y canvas coordinates')
    for p in specs:
        pid = p['id']
        for key in ('source', 'mask', 'role', 'kind'):
            if key not in p:
                raise ValueError(f'{pid}: missing {key}')
        if p['source'] not in ('normal', 'flat', 'blink', 'mouth_closed'):
            raise ValueError(f'{pid}: unknown source')
        local_path(root, p['mask'])
        if p['kind'] not in KINDS:
            raise ValueError(f'{pid}: unsupported kind {p["kind"]}')
        if p.get('parent') and p['parent'] not in groups:
            raise ValueError(f'{pid}: parent must name a group')
        if not 0 <= p.get('opacity', 1) <= 1 or not 0 <= p.get('pad', 8) <= 64:
            raise ValueError(f'{pid}: invalid opacity/pad')
        if p.get('capture_side') not in (None,'left','right'):raise ValueError(f'{pid}: capture_side must be screen left/right')
        if physics := p.get('physics'):
            if physics.get('type')!='long_hair' or p['role']!='hair':raise ValueError(f'{pid}: long_hair physics requires a hair part')
            for key,default,low,high in [('stiffness',16,1,100),('damping',7,.1,30)]:
                value=physics.get(key,default)
                if not isinstance(value,(int,float)) or isinstance(value,bool) or not low<=value<=high:raise ValueError(f'{pid}: invalid physics {key}')
        mesh = p.get('mesh', {})
        if mesh and mesh.get('type') not in MESHES:
            raise ValueError(f'{pid}: unsupported mesh type')
        for field, low, high in [('rings', 1, 12), ('spokes', 8, 128), ('slices', 1, 128)]:
            if field in mesh and (not isinstance(mesh[field], int) or not low <= mesh[field] <= high):
                raise ValueError(f'{pid}: invalid mesh {field}')
        if p.get('closed_part'):
            closed = parts.get(p['closed_part'])
            expected = ('drawn_eye_closed', 'eye_closed') if p['kind'] in ('eye_open','eye_sclera') else ('mouth_closed',)
            if closed is None or closed['kind'] not in expected:
                raise ValueError(f'{pid}: closed_part must reference its closed endpoint')
            if order.index(p['closed_part']) < order.index(pid):
                raise ValueError(f'{pid}: closed art must be drawn after open art')
        if p['kind']=='eye_sclera':
            iris=parts.get(p.get('iris_part'))
            if iris is None or iris['kind']!='eye_iris' or iris.get('clip_to')!=pid:
                raise ValueError(f'{pid}: sclera needs a paired iris with clip_to')
            if not p.get('closed_part'):raise ValueError(f'{pid}: split eye requires closed_part')
        if p['kind'] in ('eye_iris','eye_line'):
            owner=parts.get(p.get('clip_to'))
            if owner is None or owner['kind']!='eye_sclera':raise ValueError(f'{pid}: clip_to must name eye_sclera')
            if order.index(owner['id'])>order.index(pid):raise ValueError('Sclera must be drawn before iris/eye line')
            if owner.get('closed_part') and order.index(pid)>order.index(owner['closed_part']):raise ValueError('Closed eye must follow all open components')
        if p.get('transform_from') and p['transform_from'] not in parts:
            raise ValueError(f'{pid}: missing transform_from part')
        for feature in ('texture_repair', 'seam'):
            if feature not in p:
                continue
            data = p[feature]
            for key in ('file', 'mask'):
                local_path(root, data[key])
            if p['role'] in ('eye', 'mouth') or p['kind'] in ('static', 'blush') or p['role'] == 'base':
                raise ValueError(f'{pid}: {feature} cannot modify facial expressions or static base')
    for pid in parts:
        seen = set()
        current = pid
        while parts[current].get('transform_from'):
            if current in seen:
                raise ValueError(f'{pid}: transform_from cycle')
            seen.add(current)
            current = parts[current]['transform_from']


def validate_project(root, project):
    order = project['draw_order']
    if len(order) != len(set(order)) or set(order) != set(project['parts']):
        raise ValueError('Invalid project draw_order')
    for pid, p in project['parts'].items():
        for key in ('file', 'mask'):
            path = local_path(root, p[key])
            if not path.is_file():
                raise ValueError(f'{pid}: missing {key}: {path}')
        if digest(local_path(root,p['file'])) != p['sha256']:
            raise ValueError(f'{pid}: layer data is stale; rebuild')
        if p.get('seam') and digest(local_path(root, p['seam']['file'])) != p['seam']['sha256']:
            raise ValueError(f'{pid}: seam data is stale')
    for role,file in project['sources'].items():
        if digest(local_path(root,file)) != digest(root/'work/aligned'/f'{role}.png'):
            raise ValueError(f'{role}: source copy is stale')
    html = preview_path(root).read_text()
    match = re.search(r'<script id="projectData" type="application/json">(.*?)</script>', html, re.S)
    if match is None or json.loads(match[1]) != project:
        raise ValueError('Embedded projectData differs from rig.project.json')
    verify_sources(root)
