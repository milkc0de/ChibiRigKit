// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
const fs=require('node:fs'),path=require('node:path');
const {launcherFiles}=require('./player_launchers.cjs');
const TEMPLATE=path.resolve(__dirname,'../template/workspace');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function idleResources(root){
 const model=path.join(root,'assets/idle/a-pose.glb');
 if(!fs.existsSync(model))return '';
 const directory=path.join(__dirname,'idle3d');
 const script=['idle-renderer.min.js','player-integration.js'].map(name=>fs.readFileSync(path.join(directory,name),'utf8')).join('\n').replace(/<\/script/gi,tag=>'<\\/'+tag.slice(2));
 return '<script id="idleModel3D" type="application/octet-stream">'+fs.readFileSync(model).toString('base64')+'</script>\n<script>'+script+'\n</script>';
}
function renderProject(root,{project=JSON.parse(fs.readFileSync(path.join(root,'rig.project.json'),'utf8')),template=TEMPLATE}={}){
 let html=fs.readFileSync(path.join(template,'runtime/index.template.html'),'utf8');
 html=html.replace(/__([A-Z_]+)_JS__/g,(_m,name)=>fs.readFileSync(path.join(template,'runtime',name.toLowerCase()+'.js'),'utf8'));
 const values={PLAYER_LAUNCHERS_JSON:JSON.stringify(launcherFiles(template)).replace(/</g,'\\u003c'),LICENSE_TEXT:fs.readFileSync(path.join(root,'LICENSE.txt'),'utf8'),MEDIA_NOTICE_TEXT:fs.readFileSync(path.join(root,'MEDIA_NOTICE.txt'),'utf8'),TITLE:escape(project.name),W:project.canvas.width,H:project.canvas.height,PROJECT_JSON:JSON.stringify(project).replace(/</g,'\\u003c')};
 html=html.replace(/__(PLAYER_LAUNCHERS_JSON|LICENSE_TEXT|MEDIA_NOTICE_TEXT|TITLE|W|H|PROJECT_JSON)__/g,(_m,key)=>String(values[key]));
 return html.replace('__IDLE_RESOURCES__',()=>idleResources(root));
}
module.exports={renderProject};
