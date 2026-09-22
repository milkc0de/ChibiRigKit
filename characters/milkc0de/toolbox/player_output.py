# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Final artifacts go to the kit's dist; authoring preview stays under work/."""
import base64,json,re,zipfile,os,uuid
from pathlib import Path

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
    files={'index.html':rendered.encode(),'rig.project.json':(json.dumps(project,ensure_ascii=False,indent=2)+'\n').encode(),'LICENSE.txt':(root/'LICENSE.txt').read_bytes()}
    if (root/'motion.template.json').exists():files['motion.json']=(root/'motion.template.json').read_bytes()
    if project.get('head_pose'):files['head-poses.json']=json.dumps(project['head_pose'],ensure_ascii=False,indent=2).encode()
    files['README.txt']='ChibiRigKit 完成品\nindex.htmlをブラウザで開いてください。完成品の再生・調整・動画保存にインターネット接続は不要です。\nカメラ・音声は初回準備済みの親フォルダで npm run player から使用します。初回準備とCodexによる制作にはインターネット接続が必要です。\n制作中の入力・マスク・作業履歴は含みません。\nキャラクター画像の権利は各権利者に帰属します。\n'.encode()
    def image(file,url):
        if not re.fullmatch(r'data:image/(png|webp|jpeg);base64,[a-zA-Z0-9+/=]+',url):raise ValueError('Only embedded raster images can be exported')
        files[file]=base64.b64decode(url.split(',',1)[1],validate=True)
    for part in project['parts'].values():
        image(part['file'],part['image_data_url'])
        if part.get('seam'):image(part['seam']['file'],part['seam']['data_url'])
    if project.get('neck_fill'):image(project['neck_fill']['file'],project['neck_fill']['data_url'])
    def safe_target(relative):
        if '\\' in relative or Path(relative).is_absolute() or '..' in Path(relative).parts:raise ValueError('Unsafe output path')
        target=dist/relative
        for current in [target,*target.parents]:
            if current.is_symlink():raise ValueError('Output symlink is not allowed')
            if current==dist:break
        return target
    previous={'capture.chibimotion.json','background.json','motion.json','head-poses.json'}
    try:
        old=json.loads(safe_target(name+'/rig.project.json').read_text())
        for part in old.get('parts',{}).values():
            previous.update(f for f in [part.get('file'),part.get('seam',{}).get('file')] if f)
        if old.get('neck_fill',{}).get('file'):previous.add(old['neck_fill']['file'])
    except (FileNotFoundError,json.JSONDecodeError):pass
    obsolete=[safe_target(name+'/'+f) for f in previous if f not in files and (re.fullmatch(r'(capture\.chibimotion|background|motion|head-poses)\.json',f) or re.fullmatch(r'assets/[A-Za-z0-9_./-]+\.(png|webp|jpe?g)',f,re.I))]
    targets=[(safe_target(name+'/'+relative),data) for relative,data in files.items()]
    archive=safe_target(name+'.zip')
    for target,data in targets:
        target.parent.mkdir(parents=True,exist_ok=True);temp=target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
        try:
            with temp.open('xb') as handle:handle.write(data)
            os.replace(temp,target)
        finally:temp.unlink(missing_ok=True)
    temp=archive.with_name(archive.name+'.'+uuid.uuid4().hex+'.tmp')
    with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for relative,data in files.items():z.writestr(relative,data)
    os.replace(temp,archive)
    for target in obsolete:target.unlink(missing_ok=True)
    result={'directory':str(folder),'html':str(folder/'index.html'),'zip':str(archive)}
    (root/'work').mkdir(exist_ok=True);(root/'work/player-output.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result
