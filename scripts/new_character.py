#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
import argparse,json,re,shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TEMPLATE=ROOT/'template'/'workspace'

def slugify(s):
    s=re.sub(r'[^A-Za-z0-9._-]+','-',s.strip()).strip('-')
    return s or 'character'

ap=argparse.ArgumentParser(description='Create a generic ChibiRigKit character workspace')
ap.add_argument('--name')
ap.add_argument('--normal',required=True)
ap.add_argument('--flat')
ap.add_argument('--blink')
ap.add_argument('--mouth-closed')
ap.add_argument('--output')
args=ap.parse_args()
args.name=args.name or Path(args.normal).stem
slug=slugify(args.name);dst=Path(args.output).expanduser().resolve() if args.output else (ROOT/'characters'/slug)
if dst.exists() and any(dst.iterdir()):raise SystemExit(f'{dst} already exists and is not empty')
dst.mkdir(parents=True,exist_ok=True)
shutil.copytree(TEMPLATE,dst,dirs_exist_ok=True,ignore=shutil.ignore_patterns("__pycache__","*.pyc"))
inputs=dst/'input';inputs.mkdir(exist_ok=True)
roles={}
for role,value in [('normal',args.normal),('flat',args.flat),('blink',args.blink),('mouth_closed',args.mouth_closed)]:
    if not value:roles[role]=None;continue
    src=Path(value).expanduser().resolve()
    if not src.exists():raise SystemExit(f'Missing {role}: {src}')
    ext=src.suffix.lower() or '.png';name=f'{role}{ext}';shutil.copy2(src,inputs/name);roles[role]=name
cfg=json.loads((dst/'character.config.json').read_text());cfg['name']=args.name;cfg['inputs']=roles;(dst/'character.config.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+'\n')
print(dst)
