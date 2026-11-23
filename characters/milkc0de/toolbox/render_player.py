#!/usr/bin/env python3
"""Render existing authored data with the current runtime; never rebuild images."""
import base64,html,json,re
from pathlib import Path
from player_output import preview_path,export_player,launcher_files
ROOT=Path(__file__).resolve().parents[1]

def idle_resources(root,runtime_root):
    asset=root/'assets/idle/a-pose.glb'
    if not asset.is_file():return ''
    for base in (runtime_root,root):
        for parent in (base.resolve(),*base.resolve().parents):
            studio=parent/'studio/idle3d'
            if (studio/'idle-renderer.min.js').is_file():
                script=(studio/'idle-renderer.min.js').read_text()+'\n'+(studio/'player-integration.js').read_text()
                script=re.sub(r'</script',lambda match:'<\\/'+match.group(0)[2:],script,flags=re.I)
                data=base64.b64encode(asset.read_bytes()).decode('ascii')
                return f'<script id="idleModel3D" type="application/octet-stream">{data}</script>\n<script>{script}\n</script>'
    raise FileNotFoundError('3D idle renderer for '+str(asset))

def render_project(root,runtime_root=None):
    root=Path(root);runtime_root=Path(runtime_root or root)
    project=json.loads((root/'rig.project.json').read_text())
    rendered=(runtime_root/'runtime/index.template.html').read_text()
    for name in ['recording','bundle','background','head_pose','project_io','motion_clip','capture_player','expression_underpaint','hair_dynamics','hair_player','tracking_core','tracking','output','player_sync']:
        rendered=rendered.replace('__'+name.upper()+'_JS__',(runtime_root/'runtime'/(name+'.js')).read_text())
    values={'PLAYER_LAUNCHERS_JSON':json.dumps(launcher_files(runtime_root),ensure_ascii=False).replace('<','\\u003c'),'LICENSE_TEXT':(root/'LICENSE.txt').read_text(),'MEDIA_NOTICE_TEXT':(root/'MEDIA_NOTICE.txt').read_text(),'TITLE':html.escape(project['name']),'W':str(project['canvas']['width']),'H':str(project['canvas']['height']),'PROJECT_JSON':json.dumps(project,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')}
    for key,value in values.items():rendered=rendered.replace('__'+key+'__',value)
    rendered=rendered.replace('__IDLE_RESOURCES__',idle_resources(root,runtime_root))
    return rendered,project

def main():
    rendered,project=render_project(ROOT);preview_path(ROOT).parent.mkdir(parents=True,exist_ok=True);preview_path(ROOT).write_text(rendered)
    print(json.dumps(export_player(ROOT,rendered,project),ensure_ascii=False))
if __name__=='__main__':main()
