#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
"""Import browser-authored head poses into the rebuildable plan."""
import argparse,json
from pathlib import Path
from head_pose import build_head_pose
ROOT=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser();ap.add_argument('--file',required=True);args=ap.parse_args()
project=json.loads((ROOT/'rig.project.json').read_text())
data=json.loads(Path(args.file).expanduser().read_text())
if data.get('layout_signature')!=project.get('head_pose',{}).get('layout_signature') or data.get('version')!=1:
    raise SystemExit('Saved poses do not match this character layout')
validated=build_head_pose({'head_pose':data},project['parts'],project['canvas'])
plan=json.loads((ROOT/'rig.plan.json').read_text());plan['head_pose']=validated
pending=ROOT/'rig.plan.json.tmp';pending.write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n');pending.replace(ROOT/'rig.plan.json')
print('9 directions imported into rig.plan.json. Run toolbox/build_project.py to rebuild.')
