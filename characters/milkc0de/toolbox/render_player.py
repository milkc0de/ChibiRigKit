#!/usr/bin/env python3
"""Render existing authored data with the current runtime; never rebuild images."""
import html,json
from pathlib import Path
from player_output import preview_path,export_player
ROOT=Path(__file__).resolve().parents[1]

def render_project(root,runtime_root=None):
    root=Path(root);runtime_root=Path(runtime_root or root)
    project=json.loads((root/'rig.project.json').read_text())
    rendered=(runtime_root/'runtime/index.template.html').read_text()
    for name in ['recording','bundle','background','head_pose','project_io','motion_clip','capture_player','expression_underpaint','hair_dynamics','hair_player','tracking_core','tracking','output']:
        rendered=rendered.replace('__'+name.upper()+'_JS__',(runtime_root/'runtime'/(name+'.js')).read_text())
    values={'LICENSE_TEXT':(root/'LICENSE.txt').read_text(),'TITLE':html.escape(project['name']),'W':str(project['canvas']['width']),'H':str(project['canvas']['height']),'PROJECT_JSON':json.dumps(project,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')}
    for key,value in values.items():rendered=rendered.replace('__'+key+'__',value)
    return rendered,project

def main():
    rendered,project=render_project(ROOT);preview_path(ROOT).parent.mkdir(parents=True,exist_ok=True);preview_path(ROOT).write_text(rendered)
    print(json.dumps(export_player(ROOT,rendered,project),ensure_ascii=False))
if __name__=='__main__':main()
