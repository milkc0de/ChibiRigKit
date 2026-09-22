# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Final artifacts go to the kit's dist; authoring preview stays under work/."""
import base64,json,re,zipfile,os,uuid
from pathlib import Path

LAUNCHER_NAMES=('START_SERVER.ps1','START_SERVER.cmd','START_SERVER.command','START_SERVER.sh','PLAYER_SERVER.py')
def launcher_files(runtime_root=None):
    folder=Path(runtime_root or Path(__file__).resolve().parents[1])/'launchers'
    return {name:(folder/name).read_bytes().decode('utf-8') for name in LAUNCHER_NAMES}

def preview_path(root):return Path(root)/'work/player/index.html'
def output_paths(root,character_name=None):
    root=Path(root).resolve();kit=None
    for parent in [root,*root.parents]:
        try:
            if json.loads((parent/'package.json').read_text()).get('name')=='chibirigkit':kit=parent;break
        except (OSError,ValueError):pass
    dist=Path(os.environ['CHIBIRIG_DIST_ROOT']).resolve() if os.environ.get('CHIBIRIG_DIST_ROOT') else (kit or root)/'dist';name=re.sub(r'[^\w.-]+','-',str(character_name or root.name)).strip('.-') or 'character'
    if name.upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]}:name='character-'+name
    return dist,name

def export_player(root,rendered,project):
    root=Path(root)
    embedded=re.search(r'<script id="projectData" type="application/json">(.*?)</script>',rendered,re.S)
    if not embedded or json.loads(embedded[1])!=project:raise ValueError('Export HTML and project differ; rebuild the preview first')
    dist,name=output_paths(root,project.get('name'));folder=dist/name
    files={'index.html':rendered.encode(),'LICENSE.txt':(root/'LICENSE.txt').read_bytes(),**{name:source.encode() for name,source in launcher_files().items()}}
    def image(url):
        if not re.fullmatch(r'data:image/(png|webp|jpeg);base64,[a-zA-Z0-9+/=]+',url):raise ValueError('Only embedded raster images can be exported')
        base64.b64decode(url.split(',',1)[1],validate=True)
    for part in project['parts'].values():
        image(part['image_data_url'])
        if part.get('seam'):image(part['seam']['data_url'])
    if project.get('neck_fill'):image(project['neck_fill']['data_url'])
    def safe_target(relative):
        if '\\' in relative or Path(relative).is_absolute() or '..' in Path(relative).parts:raise ValueError('Unsafe output path')
        target=dist/relative
        for current in [target,*target.parents]:
            if current.is_symlink():raise ValueError('Output symlink is not allowed')
            if current==dist:break
        return target
    previous={'rig.project.json','README.txt','capture.chibimotion.json','background.json','motion.json','head-poses.json'}
    try:
        old=json.loads(safe_target(name+'/rig.project.json').read_text())
        for part in old.get('parts',{}).values():
            previous.update(f for f in [part.get('file'),part.get('seam',{}).get('file')] if f)
        if old.get('neck_fill',{}).get('file'):previous.add(old['neck_fill']['file'])
    except (FileNotFoundError,json.JSONDecodeError):pass
    obsolete=[safe_target(name+'/'+f) for f in previous if f not in files and (f in {'rig.project.json','README.txt'} or re.fullmatch(r'(capture\.chibimotion|background|motion|head-poses)\.json',f) or re.fullmatch(r'assets/[A-Za-z0-9_./-]+\.(png|webp|jpe?g)',f,re.I))]
    targets=[(safe_target(name+'/'+relative),data) for relative,data in files.items()]
    archive=safe_target(name+'.zip')
    for target,data in targets:
        target.parent.mkdir(parents=True,exist_ok=True);temp=target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
        try:
            with temp.open('xb') as handle:handle.write(data)
            if target.suffix in {'.sh','.command'}:temp.chmod(0o755)
            os.replace(temp,target)
        finally:temp.unlink(missing_ok=True)
    temp=archive.with_name(archive.name+'.'+uuid.uuid4().hex+'.tmp')
    with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for relative,data in files.items():
            info=zipfile.ZipInfo(relative);info.create_system=3;info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=(0o100755 if relative.endswith(('.sh','.command')) else 0o100644)<<16
            z.writestr(info,data)
    os.replace(temp,archive)
    for target in obsolete:
        target.unlink(missing_ok=True)
        # Remove only empty directories left by generated assets.
        parent=target.parent
        while parent!=folder:
            try:parent.rmdir()
            except OSError:break
            parent=parent.parent
    result={'directory':str(folder),'html':str(folder/'index.html'),'zip':str(archive)}
    (root/'work').mkdir(exist_ok=True);(root/'work/player-output.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result
