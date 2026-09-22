// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const crypto=require('node:crypto');
const LIVE_KEYS=new Set(['headYaw','headPitch','headRoll','eyeLeft','eyeRight','gazeX','gazeY','mouthOpen','mouthShape','browLeftX','browRightX','browLeftY','browRightY','browLeftAngle','browRightAngle','browLeftShape','browRightShape']);
function createPlayerSync({character=crypto.randomBytes(16).toString('hex')}={}){
 const token=crypto.randomBytes(32).toString('hex'),clients=new Set();let state=null,revision=0,live={active:false,values:{}};
 const snapshot=()=>({character,revision,state});
 const event=(name,data)=>`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
 function broadcast(name,data){for(const res of clients){if(res.destroyed||res.writableLength>2*1024*1024){res.destroy();clients.delete(res)}else res.write(event(name,data))}}
 return {
  inject(html,view=false){return html.replace('<head>','<head>\n<script id="playerSyncConfig" type="application/json">'+JSON.stringify({role:view?'view':'control'})+'</script>')},
  async handle(req,res,url,body,json){
   if(!url.pathname.startsWith('/api/player-sync/'))return false;
   const respond=(code,data)=>json(res,code,data);
   if(req.method==='GET'){
    if(url.pathname.endsWith('/session'))respond(200,{token,character});
    else if(url.pathname.endsWith('/state'))respond(200,snapshot());
    else if(url.pathname.endsWith('/events')){
     if(url.searchParams.get('token')!==token){respond(403,{error:'再接続してください'});return true}
     res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store'});res.write(event('settings',snapshot()));res.write(event('live',live));clients.add(res);
     const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': keepalive\n\n')},10000);res.on('close',()=>{clearInterval(heartbeat);clients.delete(res)});
    }else respond(404,{error:'操作がありません'});
   }else if(req.method==='POST'){
    if(req.headers['x-chibirig-sync-token']!==token){respond(403,{error:'操作画面からのみ変更できます'});return true}
    const data=await body(req);
    if(data.character!==character){respond(409,{error:'画面を再読み込みしてください'});return true}
    if(url.pathname.endsWith('/state')){
     const s=data.state;if(!s||Object.keys(s).sort().join()!=='background,capture,extras,motion,playback'||s.motion?.format!=='chibirigkit.motion'){respond(400,{error:'共有設定が不正です'});return true}
     if(Buffer.byteLength(JSON.stringify(s))>32*1024*1024){respond(413,{error:'共有データは32MB以内にしてください'});return true}
     state=s;revision++;broadcast('settings',snapshot());respond(200,{revision});
    }else if(url.pathname.endsWith('/live')){
     const next=data.live;
     if(!next||typeof next.active!=='boolean'||!next.values||Array.isArray(next.values)||Object.entries(next.values).some(([k,v])=>!LIVE_KEYS.has(k)||!Number.isFinite(v)||Math.abs(v)>1000)){respond(400,{error:'追従データが不正です'});return true}
     live={active:next.active,values:next.active?next.values:{},updatedAt:Date.now()};broadcast('live',live);respond(200,{ok:true});
    }else respond(404,{error:'操作がありません'});
   }else respond(405,{error:'Method not allowed'});
   return true;
  },
  close(){for(const res of clients)res.end();clients.clear()}
 };
}
module.exports={createPlayerSync};
