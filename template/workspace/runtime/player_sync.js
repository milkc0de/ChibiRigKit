// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
// Only the dedicated loopback server injects the opt-in bootstrap marker.
const playerSyncClockOrigin=Date.now()-performance.now();
const playerSync={role:null,active:false,applying:false,busy:false,dirty:false,timer:null,retry:null,session:null,events:null,revision:-1,received:-1,last:null,generation:0};
function playerSyncIsViewer(){return playerSync.role==='view'}
function playerSyncMessage(message){if($('playerSyncStatus'))$('playerSyncStatus').textContent=message}
function collectPlayerSync(){
 const clip=captureMotion?.clip;
 return {motion:collectMotionPreset(),background:{...backgroundState,image:backgroundState.mode==='image'?backgroundState.image:null,name:backgroundState.mode==='image'?'背景画像':''},
  extras:{hairPhysics:$('hairPhysics').checked,hairPhysicsAmount:Number($('hairPhysicsAmount').value),showBaseOnly:controls.showBaseOnly.checked,seed:headRandomSeed,randomStart:headRandomStart,randomFrom:[...headRandomFrom],crop:{...outputState.crop},color:$('outputColor').value},
  playback:{running,epoch:playerSyncClockOrigin+start,pausedAt},
  capture:clip?{source:{format:'ChibiRigMotion',version:1,timeUnit:'seconds',duration:clip.duration,loop:clip.loop,channels:clip.channels,frames:clip.frames},playing:capturePlaying,offset:captureOffset,hold:captureHold,speed:captureSpeed,loop:$('captureLoop').checked}:null};
}
function validatePlayerSync(data){
 if(!data||typeof data!=='object')throw Error('共有設定が不正です');
 validateMotionProject(data.motion);const background=validBackground(data.background),e=data.extras,p=data.playback;
 if(!e||typeof e.hairPhysics!=='boolean'||typeof e.showBaseOnly!=='boolean'||!Number.isFinite(e.hairPhysicsAmount)||e.hairPhysicsAmount<0||e.hairPhysicsAmount>2||!Number.isInteger(e.seed)||e.seed<0||e.seed>0xffffffff||!Number.isFinite(e.randomStart)||!Array.isArray(e.randomFrom)||e.randomFrom.length!==2||!e.randomFrom.every(Number.isFinite)||!/^#[a-f0-9]{6}$/i.test(e.color))throw Error('表示設定が不正です');
 validOutputCrop(e.crop);
 if(!p||typeof p.running!=='boolean'||!Number.isFinite(p.epoch)||!Number.isFinite(p.pausedAt)||p.pausedAt<0)throw Error('再生設定が不正です');
 if(data.capture){const c=data.capture;MotionClip.parse(c.source);if(typeof c.playing!=='boolean'||typeof c.loop!=='boolean'||![c.offset,c.hold,c.speed].every(Number.isFinite)||c.hold<0||c.speed<.1||c.speed>5)throw Error('モーション再生設定が不正です')}
 return background;
}
async function applyPlayerSync(data,revision=0){
 const generation=playerSync.generation,background=validatePlayerSync(data),image=background.image?await loadImage(background.image):null;
 if(generation!==playerSync.generation||revision<playerSync.received)return false;
 playerSync.applying=true;
 try{
  applyMotionProject(data.motion);
  backgroundRevision++;backgroundState=background;backgroundImage=image;syncBackground();
  const e=data.extras,p=data.playback;
  $('hairPhysics').checked=e.hairPhysics;$('hairPhysicsAmount').value=e.hairPhysicsAmount;$('hairPhysicsOut').textContent=e.hairPhysicsAmount.toFixed(2)+'×';controls.showBaseOnly.checked=e.showBaseOnly;
  headRandomSeed=e.seed;headRandomStart=e.randomStart;headRandomFrom=[...e.randomFrom];outputState.crop=validOutputCrop(e.crop);$('outputColor').value=e.color;drawCropOverlay();$('cropInfo').textContent=`${Math.round(e.crop.w)} × ${Math.round(e.crop.h)} px`;
  if(data.capture){const c=data.capture;loadCaptureMotion(c.source,'共有モーション');capturePlaying=c.playing;captureOffset=c.offset;captureHold=c.hold;captureSpeed=c.speed;$('captureLoop').checked=c.loop;controls.showBaseOnly.checked=e.showBaseOnly;}
  else if(captureMotion)clearCaptureMotion();
  running=p.running;start=p.epoch-playerSyncClockOrigin;pausedAt=p.pausedAt;syncCaptureUI(captureMotion?capturePosition(captureTime()):0);
  playerSync.revision=revision;requestRender();render(captureTime());
  return true;
 }finally{playerSync.applying=false}
}
function schedulePlayerSync(){
 if(!playerSync.active||playerSync.role!=='control'||playerSync.applying)return;
 playerSync.dirty=true;
 if(playerSync.timer!==null||playerSync.busy)return;
 playerSync.timer=setTimeout(()=>{playerSync.timer=null;void publishPlayerSync()},60);
}
async function publishPlayerSync(){
 if(!playerSync.active||playerSync.role!=='control'||playerSync.busy)return;
 playerSync.busy=true;playerSync.dirty=false;
 try{
  const state=collectPlayerSync(),serialized=JSON.stringify(state);if(serialized===playerSync.last)return;
  const response=await fetch('/api/player-sync/state',{method:'POST',headers:{'Content-Type':'application/json','X-ChibiRig-Sync-Token':playerSync.session.token},body:JSON.stringify({character:playerSync.session.character,state})});
  const result=await response.json();if(!response.ok){playerSyncMessage('共有できません：'+(result.error||'設定を送信できません'));if(response.status===403||response.status===409)reconnectPlayerSync();return}
  playerSync.last=serialized;playerSyncMessage('表示を共有中です。OBS用URL：'+location.protocol+'//'+location.host+'/obs');
 }catch(error){playerSyncMessage('共有できません：'+error.message);reconnectPlayerSync()}
 finally{playerSync.busy=false;if(playerSync.dirty)schedulePlayerSync()}
}
function reconnectPlayerSync(){
 playerSync.active=false;playerSync.events?.close();playerSync.events=null;
 if(playerSync.retry===null)playerSync.retry=setTimeout(()=>{playerSync.retry=null;void connectPlayerSync()},1500);
}
async function connectPlayerSync(){
 const generation=++playerSync.generation;
 try{
  const response=await fetch('/api/player-sync/session');if(!response.ok)throw Error('サーバーに接続できません');const session=await response.json();
  if(playerSync.session&&session.character!==playerSync.session.character){playerSyncMessage('キャラが切り替わりました。画面を再読み込みしてください。');return}
  const r=await fetch('/api/player-sync/state');if(!r.ok)throw Error('設定を取得できません');const latest=await r.json();
  if(generation!==playerSync.generation)return;
  const recoveringControl=playerSync.role==='control'&&playerSync.session!==null;
  playerSync.session=session;playerSync.received=latest.revision;playerSync.revision=-1;
  if(latest.state&&!recoveringControl)await applyPlayerSync(latest.state,latest.revision);
  playerSync.active=true;playerSync.last=null;
  const source=new EventSource('/api/player-sync/events?token='+encodeURIComponent(session.token));playerSync.events=source;
  source.addEventListener('settings',event=>{
   if(generation!==playerSync.generation||!playerSyncIsViewer())return;
   try{
    const latest=JSON.parse(event.data);if(latest.character!==session.character)throw Error('キャラが一致しません');
    if(latest.revision<=playerSync.received)return;playerSync.received=latest.revision;
    if(latest.state)void applyPlayerSync(latest.state,latest.revision).catch(error=>playerSyncMessage('共有設定を読み込めません：'+error.message));
   }catch(error){playerSyncMessage(error.message)}
  });
  source.addEventListener('live',event=>{if(generation===playerSync.generation&&playerSyncIsViewer()){try{receivePlayerSyncLive(JSON.parse(event.data))}catch{}}});
  source.onerror=()=>{if(generation!==playerSync.generation)return;playerSyncMessage('再接続しています。現在の表示は保持します。');reconnectPlayerSync()};
  playerSyncMessage(playerSyncIsViewer()?'操作画面の設定を受信しています。':'表示を共有中です。OBS用URL：'+location.protocol+'//'+location.host+'/obs');
  if(playerSync.role==='control'){schedulePlayerSync();void publishPlayerSyncLive(true)}
 }catch(error){playerSyncMessage('接続待ち：'+error.message);reconnectPlayerSync()}
}
function initPlayerSync(){
 const bootstrap=$('playerSyncConfig');if(!bootstrap)return;
 const config=JSON.parse(bootstrap.textContent);if(!['control','view'].includes(config.role))return;playerSync.role=config.role;
 if(playerSyncIsViewer()){
  document.documentElement?.setAttribute('data-player-view','');
  for(const el of document.querySelectorAll('input,button,select'))el.disabled=true;
 }else{
  startPlayerSyncClock();
  for(const event of ['input','change','click','pointerup'])document.addEventListener(event,schedulePlayerSync);
 }
 void connectPlayerSync();
 window.addEventListener('pagehide',()=>{playerSync.active=false;playerSync.generation++;playerSync.events?.close();clearTimeout(playerSync.timer);clearTimeout(playerSync.retry)});
}

// Relay only already-solved face values. Never video, audio or device identifiers.
const playerSyncLive={value:null,received:0,history:[],busy:false,lastSent:0,pendingStop:false,clockWorker:null};
function playerSyncLiveActive(){return playerSyncIsViewer()&&playerSyncLive.value?.active&&performance.now()-playerSyncLive.received<1500}
function receivePlayerSyncLive(data){
 if(!data||typeof data.active!=='boolean'||!data.values||Object.entries(data.values).some(([key,value])=>!captureParameters.has(key)||!Number.isFinite(value)))return;
 playerSyncLive.value=data;playerSyncLive.received=performance.now()-(Number.isFinite(data.updatedAt)?Math.max(0,Date.now()-data.updatedAt):0);
 if(!data.active)playerSyncLive.history=[];
 else{const time=(performance.now()-start)/1000;playerSyncLive.history.push({time,values:{...data.values}});while(playerSyncLive.history.length&&playerSyncLive.history[0].time<time-4)playerSyncLive.history.shift()}
 frameDirty=true;
}
function expirePlayerSyncLive(){if(playerSyncIsViewer()&&playerSyncLive.value?.active&&!playerSyncLiveActive()){playerSyncLive.value.active=false;playerSyncLive.history=[];frameDirty=true}}
function samplePlayerSyncLive(time){
 const history=playerSyncLive.history;if(!history.length)return playerSyncLive.value?.values;
 let a=history[0];for(const b of history){if(b.time>=time){const u=b.time===a.time?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));return Object.fromEntries(Object.keys(b.values).map(k=>[k,(a.values[k]??b.values[k])+((b.values[k])-(a.values[k]??b.values[k]))*u]))}a=b}return a.values;
}
async function publishPlayerSyncLive(force=false){
 if(!playerSync.active||playerSync.role!=='control')return;
 if(playerSyncLive.busy){if(force)playerSyncLive.pendingStop=true;return}
 const now=performance.now();if(!force&&now-playerSyncLive.lastSent<33)return;
 playerSyncLive.lastSent=now;playerSyncLive.busy=true;
 try{await fetch('/api/player-sync/live',{method:'POST',keepalive:force&&!trackingState.active,headers:{'Content-Type':'application/json','X-ChibiRig-Sync-Token':playerSync.session.token},body:JSON.stringify({character:playerSync.session.character,live:{active:trackingState.active,values:liveCaptureFrame()||{}}})})}
 catch{ /* SSE connection handles reconnection; the viewer expires stale poses. */ }
 finally{playerSyncLive.busy=false;if(playerSyncLive.pendingStop){playerSyncLive.pendingStop=false;void publishPlayerSyncLive(true)}}
}
function startPlayerSyncClock(){
 if(typeof Worker==='undefined'||playerSyncLive.clockWorker)return;
 const url=URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),33)'],{type:'text/javascript'}));
 try{const worker=new Worker(url);playerSyncLive.clockWorker=worker;worker.onmessage=()=>{if(document.visibilityState==='hidden'&&trackingState.active)trackingTick(performance.now())}}
 catch{ /* Foreground tracking remains available if background workers are blocked. */ }
 finally{URL.revokeObjectURL(url)}
 window.addEventListener('pagehide',()=>{playerSyncLive.clockWorker?.terminate();playerSyncLive.clockWorker=null});
}
