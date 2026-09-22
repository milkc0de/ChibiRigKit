#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'template/workspace/toolbox'))
from player_output import export_player,preview_path
from render_player import render_project
ap=argparse.ArgumentParser();ap.add_argument('--character',required=True);args=ap.parse_args();workspace=Path(args.character).expanduser().resolve()
rendered,project=render_project(workspace,ROOT/'template/workspace')
preview_path(workspace).parent.mkdir(parents=True,exist_ok=True);preview_path(workspace).write_text(rendered)
print(json.dumps(export_player(workspace,rendered,project),ensure_ascii=False))
