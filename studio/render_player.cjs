// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const fs=require('node:fs'),path=require('node:path');
const {launcherFiles}=require('./player_launchers.cjs');
const TEMPLATE=path.resolve(__dirname,'../template/workspace');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderProject(root,{project=JSON.parse(fs.readFileSync(path.join(root,'rig.project.json'),'utf8')),template=TEMPLATE}={}){
 let html=fs.readFileSync(path.join(template,'runtime/index.template.html'),'utf8');
 html=html.replace(/__([A-Z_]+)_JS__/g,(_m,name)=>fs.readFileSync(path.join(template,'runtime',name.toLowerCase()+'.js'),'utf8'));
 const values={PLAYER_LAUNCHERS_JSON:JSON.stringify(launcherFiles(template)).replace(/</g,'\\u003c'),LICENSE_TEXT:fs.readFileSync(path.join(root,'LICENSE.txt'),'utf8'),TITLE:escape(project.name),W:project.canvas.width,H:project.canvas.height,PROJECT_JSON:JSON.stringify(project).replace(/</g,'\\u003c')};
 return html.replace(/__(PLAYER_LAUNCHERS_JSON|LICENSE_TEXT|TITLE|W|H|PROJECT_JSON)__/g,(_m,key)=>String(values[key]));
}
module.exports={renderProject};
