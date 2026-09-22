// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const captureParameters=new Set(['headYaw','headPitch','headRoll','eyeLeft','eyeRight','gazeX','gazeY','mouthOpen','bodyYaw','bodyPitch','bodyRoll','breath','browLeftX','browRightX','browLeftY','browRightY','browLeftAngle','browRightAngle','browLeftShape','browRightShape','mouthShape']);
let captureMotion=null,captureFrame=null,captureOffset=0,captureSpeed=1,captureLoadSerial=0,capturePlaying=false,captureHold=0;
const captureClamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function captureValue(id,fallback=0,min=-1,max=1){return captureClamp(captureFrame?.[id]??fallback,min,max)}
function captureAxisGain(axis){const el=document.getElementById('capture'+axis+'Gain');return el&&Number.isFinite(Number(el.value))?Number(el.value):1}
function captureLiveActive(){return (typeof trackingState!=='undefined'&&trackingState.active)||(typeof playerSyncLiveActive==='function'&&playerSyncLiveActive())}
function captureHas(...keys){return !!captureFrame&&keys.some(key=>Object.hasOwn(captureFrame,key))}
function captureAffects(obj){
 if(!captureFrame)return false;
 if(obj.kind==='brow')return captureHas(...Object.keys(captureFrame).filter(k=>k.startsWith('brow')));
 if(obj.role==='eye')return captureHas('eyeLeft','eyeRight','gazeX','gazeY');
 if(obj.role==='mouth')return captureHas('mouthOpen','mouthShape');
 if(obj===PROJECT.groups?.body_sway||obj===PROJECT.groups?.head_sway)return captureHas('bodyYaw','bodyPitch','bodyRoll','breath');
 return PROJECT.neck_sway?.part_ids.includes(obj.name)?captureHas('headYaw','headPitch','headRoll'):captureHas('bodyYaw','bodyPitch','bodyRoll','breath');
}
function captureTime(){return running||captureLiveActive()?(performance.now()-start)/1000:pausedAt}
function capturePosition(t){return capturePlaying?t*captureSpeed+captureOffset:captureHold}
function setCapturePlayback(playing){
 const t=captureTime();captureHold=capturePosition(t);captureOffset=captureHold-t*captureSpeed;capturePlaying=playing;
 if(playing&&!running){if(!captureLiveActive())start=performance.now()-pausedAt*1000;running=true}
 if(!playing&&!captureLiveActive()){pausedAt=t;running=false}
 syncCaptureUI(captureClamp(captureHold,0,captureMotion?.clip.duration||0));requestRender();
}
function syncCaptureUI(position=0){
  const active=!!captureMotion;
  for(const id of ['capturePlay','captureRewind','captureClear','captureSeek','captureLoop'])$(id).disabled=!active||recordingActive;
  $('capturePlay').textContent=active&&capturePlaying?'モーション一時停止':'モーション再生';
  $('pause').textContent=(active?capturePlaying:running)?'一時停止':'再生';
  $('captureSeek').max=active?captureMotion.clip.duration:1;$('captureSeek').value=position;
  $('captureTime').textContent=`${position.toFixed(1)} / ${(captureMotion?.clip.duration??0).toFixed(1)} 秒`;
}
function fileCaptureFrame(t,{playingOnly=false}={}){
 if(!captureMotion||(playingOnly&&!capturePlaying))return null;
 const {clip}=captureMotion,raw=capturePosition(t),position=$('captureLoop').checked?((raw%clip.duration)+clip.duration)%clip.duration:captureClamp(raw,0,clip.duration);
 const values=MotionClip.sample(clip,position,false);
 return Object.fromEntries(clip.channels.map(key=>[key,values[key]]));
}
function mixedCaptureFrame(t,liveValues){
 const live=captureLiveActive(),file=fileCaptureFrame(t,{playingOnly:live});
 const remote=typeof playerSyncLiveActive==='function'&&playerSyncLiveActive();
 const input=remote?(liveValues||playerSyncLive.value.values):(live?liveCaptureFrame(liveValues):null),values={...(file||{}),...(input||{})};
 return Object.keys(values).length?values:null;
}
function beginCaptureFrame(t){
 if(captureMotion){
  const raw=capturePosition(t),duration=captureMotion.clip.duration;
  if(!$('captureLoop').checked&&raw>=duration&&capturePlaying&&!recordingActive){captureHold=duration;capturePlaying=false;if(!captureLiveActive()){pausedAt=t;running=false}}
  syncCaptureUI($('captureLoop').checked?((raw%duration)+duration)%duration:captureClamp(raw,0,duration));
 }
 captureFrame=controls.headEdit.checked?null:mixedCaptureFrame(t);
}
function loadCaptureMotion(data,name){
  const clip=MotionClip.parse(data),used=clip.tracks.filter(c=>captureParameters.has(c.id));
  if(!used.length)throw Error('このキャラに対応するモーション項目がありません');
  const ignored=clip.tracks.filter(c=>!used.includes(c)).map(c=>c.id);
  // Commit only after the entire file has passed validation.
  if($('bundleIncludeMotion'))$('bundleIncludeMotion').checked=false;
  captureMotion={clip,source:structuredClone(data),name};captureOffset=0;captureHold=0;capturePlaying=false;captureSpeed=Number(controls.motionSpeed.value);
  controls.headEdit.checked=false;controls.showBaseOnly.checked=false;
  $('captureLoop').checked=clip.loop;if(!captureLiveActive()){start=performance.now();pausedAt=0;running=false;}
  $('captureStatus').textContent=`${name}：${clip.duration.toFixed(2)} 秒・${used.length}/${clip.tracks.length} 項目を反映。モーション再生を押してください。`+(ignored.length?` 未対応：${ignored.join(', ')}`:'');
  syncCaptureUI();render(captureTime());requestRender();
}
function clearCaptureMotion(){
  captureLoadSerial++;captureMotion=null;captureFrame=null;captureOffset=0;captureHold=0;capturePlaying=false;
  $('captureStatus').textContent='モーションファイルを読み込んで再生してください。';syncCaptureUI();requestRender();
}
function seekCaptureMotion(position){
  if(!captureMotion)return;
  const t=captureTime();captureHold=captureClamp(position,0,captureMotion.clip.duration);captureOffset=captureHold-t*captureSpeed;
  render(t);requestRender();
}
function captureSide(p){if(p.capture_side==='left'||p.capture_side==='right')return p.capture_side;if(/left/i.test(p.name))return 'left';if(/right/i.test(p.name))return 'right';const x=PROJECT.neck_sway?.volume?.center?.[0]??PROJECT.canvas.width/2;return (p.pivot?.x??p.x+p.w/2)<x?'left':'right'}
function captureEyeOpen(p,fallback){
  if(!captureFrame||!['eye_open','eye_sclera','eye_iris','eye_line','drawn_eye_closed','eye_closed'].includes(p.kind))return fallback;
  return captureValue(captureSide(p)==='left'?'eyeLeft':'eyeRight',fallback,0,1);
}
function captureTransform(obj,intensity){
  const e={rot:0,x:0,y:0,sx:1,sy:1},gain=captureClamp(intensity,0,5);
  if(obj===PROJECT.groups?.body_sway||obj===PROJECT.groups?.head_sway){
    e.rot=captureValue('bodyRoll',0,-30,30)*gain;
    e.x=captureValue('bodyYaw',0,-30,30)*.7*gain;
    e.y=-captureValue('bodyPitch',0,-30,30)*.4*gain-captureValue('breath',0,0,1)*3*gain;
  }else if(obj.kind==='brow'){
    const side=captureSide(obj)==='left'?'Left':'Right';
    const sensitivity=Number($('captureBrowGain')?.value)||2;
    e.x=captureValue(`brow${side}X`)*5*gain;e.y=-captureValue(`brow${side}Y`)*16*gain*sensitivity;
    e.rot=captureValue(`brow${side}Angle`)*10*gain;
  }
  return e;
}
function captureMouthValue(){const sensitivity=Number($('captureMouthGain')?.value)||1;return captureClamp(captureValue('mouthOpen',0,0,1)*sensitivity,0,1)}
function initCapturePlayer(){
  $('captureLoad').onclick=()=>$('captureFile').click();
  $('captureFile').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;const serial=++captureLoadSerial;
    try{
      if(file.size>64*1024*1024)throw Error('64MB以内のJSONを選んでください');
      const data=JSON.parse(await file.text());if(serial!==captureLoadSerial)return;loadCaptureMotion(data,file.name);
    }catch(error){if(serial===captureLoadSerial)$('captureStatus').textContent=`読み込めません：${error.message}`}
    finally{e.target.value=''}
  };
  $('capturePlay').onclick=()=>{
    if(!captureMotion)return;
    if(controls.headEdit.checked){try{flushHeadDraft();controls.headEdit.checked=false;pausedAt=captureTime();running=false}catch(error){$('captureStatus').textContent=error.message;return}}
    if(!capturePlaying&&!$('captureLoop').checked&&capturePosition(pausedAt)>=captureMotion.clip.duration)seekCaptureMotion(0);
    setCapturePlayback(!capturePlaying);
  };
  $('captureRewind').onclick=()=>{setCapturePlayback(false);seekCaptureMotion(0)};
  $('captureClear').onclick=clearCaptureMotion;
  $('captureSeek').oninput=()=>seekCaptureMotion(Number($('captureSeek').value));
  controls.motionSpeed.addEventListener('input',()=>{
    const t=captureTime(),position=capturePosition(t);captureSpeed=Number(controls.motionSpeed.value);captureOffset=position-t*captureSpeed;
  });
  for(const id of ['captureMouthGain','captureBrowGain'])$(id).addEventListener('input',()=>{$(id+'Out').textContent=Number($(id).value).toFixed(1)+'×';requestRender()});
  syncCaptureUI();
}
