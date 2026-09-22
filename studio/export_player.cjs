// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const fs=require('node:fs/promises'),path=require('node:path');
const {parsePlayer,zipHTML}=require('./player_bundle.cjs');
async function defaultDist(root){for(let current=path.resolve(root);;current=path.dirname(current)){try{if(JSON.parse(await fs.readFile(path.join(current,'package.json'),'utf8')).name==='chibirigkit')return path.join(current,'dist')}catch{}if(path.dirname(current)===current)break}return path.join(root,'dist')}
function outputName(name){let value=String(name||'character').replace(/[^\p{L}\p{N}_.-]+/gu,'-').replace(/^[.-]+|[.-]+$/g,'').slice(0,80)||'character';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value))value='character-'+value;return value}
async function writeExport(root,data,distRoot){
 if(typeof data.html!=='string'||typeof data.zip!=='string'||data.html.length>64*1024*1024||data.zip.length>96*1024*1024)throw Error('完成品のサイズが大きすぎます');
 const zip=Buffer.from(data.zip,'base64');if(zipHTML(zip,['index.html','LICENSE.txt'])!==data.html)throw Error('HTMLとZIPが一致しません');
 const {project}=parsePlayer(Buffer.from(data.html)),name=outputName(project.name),dist=path.resolve(distRoot||await defaultDist(root)),directory=path.join(dist,name);
 const files={'index.html':data.html,'LICENSE.txt':await fs.readFile(path.join(root,'LICENSE.txt'))};
 // Check every existing path component before writing generated artifacts.
 async function safeTarget(base,relative){const target=path.resolve(base,relative);if(!target.startsWith(base+path.sep))throw Error('出力先が不正です');let current=target;while(current!==path.dirname(base)){try{if((await fs.lstat(current)).isSymbolicLink())throw Error('出力先にシンボリックリンクは使えません')}catch(e){if(e.code!=='ENOENT')throw e}current=path.dirname(current)}return target}
 // Remove only artifacts managed by previous exports, never unrelated user files.
 const previousFiles=new Set(['rig.project.json','README.txt','capture.chibimotion.json','background.json','motion.json','head-poses.json']);
 const previousProject=await safeTarget(dist,path.join(name,'rig.project.json'));
 try{
  const old=JSON.parse(await fs.readFile(previousProject,'utf8'));
  for(const part of Object.values(old.parts||{}))for(const file of [part.file,part.seam?.file])if(file)previousFiles.add(file);
  if(old.neck_fill?.file)previousFiles.add(old.neck_fill.file);
 }catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e}
 const obsolete=[];
 for(const relative of previousFiles)if(!Object.hasOwn(files,relative)&&!relative.split('/').includes('..')&&(['rig.project.json','README.txt'].includes(relative)||/^(capture\.chibimotion|background|motion|head-poses)\.json$/.test(relative)||/^assets\/[A-Za-z0-9_./-]+\.(png|webp|jpe?g)$/i.test(relative)))obsolete.push(await safeTarget(dist,path.join(name,relative)));
 const writes=[];for(const [relative,bytes] of Object.entries(files))writes.push([await safeTarget(dist,path.join(name,relative)),bytes]);writes.push([await safeTarget(dist,name+'.zip'),zip]);
 for(const [target,bytes] of writes){await fs.mkdir(path.dirname(target),{recursive:true});const temporary=target+'.'+require('node:crypto').randomUUID()+'.tmp';try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,target)}finally{await fs.rm(temporary,{force:true})}}
 for(const file of obsolete){
  await fs.rm(file,{force:true});
  for(let parent=path.dirname(file);parent!==directory;parent=path.dirname(parent)){
   try{await fs.rmdir(parent)}catch(e){if(['ENOENT','ENOTEMPTY','EEXIST'].includes(e.code))break;throw e}
  }
 }
 return {directory,html:path.join(directory,'index.html'),zip:path.join(dist,name+'.zip')};
}
module.exports={writeExport,defaultDist,outputName};
