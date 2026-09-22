// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),TEMPLATE=path.join(ROOT,'template/workspace');
const TRACKING_FILES=JSON.parse(fs.readFileSync(path.join(TEMPLATE,'launchers/TRACKING_FILES.json'),'utf8'));
function trackingFiles({kit=ROOT,template=TEMPLATE,required=false}={}){
 const vendor=path.join(kit,'vendor/mediapipe');
 if(!fs.existsSync(vendor)){if(required)throw Error('カメラ追跡の準備が必要です。npm run setup:tracking を実行してください');return {}}
 const files={};for(const name of TRACKING_FILES){const file=path.join(name.startsWith('vendor/')?kit:template,name);if(!fs.existsSync(file))throw Error('追跡ファイルが不足しています：'+name+'。npm run setup:tracking を実行してください');files[name]=fs.readFileSync(file)}return files;
}
function trackingAvailable(){try{return Object.keys(trackingFiles()).length===TRACKING_FILES.length}catch{return false}}
const DOWNLOADS=JSON.parse(fs.readFileSync(path.join(TEMPLATE,'launchers/TRACKING_DOWNLOADS.json'),'utf8')).files,crypto=require('node:crypto');
let pending;
async function ensureTracking(){
 if(pending)return pending;
 pending=(async()=>{for(const [name,source] of Object.entries(DOWNLOADS)){
  const target=path.join(ROOT,name),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  for(let current=target;current!==ROOT;current=path.dirname(current))if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Unsafe tracking path');
  if(fs.existsSync(target)&&hash(fs.readFileSync(target))===source.sha256)continue;
  const response=await fetch(source.url,{signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error('追跡ファイルの取得に失敗しました：'+response.status);
  if(Number(response.headers.get('content-length'))>32*1024*1024)throw Error('Tracking download too large');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>32*1024*1024)throw Error('Tracking download too large');chunks.push(chunk)}
  const bytes=Buffer.concat(chunks);if(hash(bytes)!==source.sha256)throw Error('追跡ファイルの検証に失敗しました');
  fs.mkdirSync(path.dirname(target),{recursive:true});const temporary=target+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,target)}finally{fs.rmSync(temporary,{force:true})}
 }return trackingFiles({required:true})})();
 try{return await pending}finally{pending=null}
}
module.exports={TRACKING_FILES,trackingFiles,trackingAvailable,ensureTracking};
