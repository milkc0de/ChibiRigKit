// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const trackingState={active:false,starting:false,inputMode:null,generation:0,stream:null,worker:null,busy:false,cancelStart:null,lastResult:0,lastTick:0,lastVideo:-1,history:[],neutral:{},latest:null,values:null,audio:null,audioValue:0,take:null,recording:null};
function trackingMessage(text){$('trackingStatus').textContent=text}
function trackingInputMode(){return (trackingState.active||trackingState.starting)?trackingState.inputMode:$('trackingInput').value}
function trackingUI(){
 const s=trackingState,locked=s.active||s.starting,audioOnly=trackingInputMode()==='audio';
 for(const id of ['trackingInput','cameraDevice','microphoneDevice'])$(id).disabled=locked;
 $('trackingEyesOff').disabled=audioOnly;$('trackingHeadOff').disabled=audioOnly;$('trackingMouthOff').disabled=audioOnly;
 if(audioOnly)$('trackingMouthOff').checked=false;
 $('cameraStart').disabled=locked;$('cameraStop').disabled=!locked;$('cameraCalibrate').disabled=!s.active||audioOnly;
 $('takeRecord').disabled=!s.active||!!s.recording;$('takeStop').disabled=!s.recording;
 for(const id of ['takeSave','takePlay'])$(id).disabled=!s.take||!!s.recording;
 $('cameraPreview').hidden=!s.stream?.getVideoTracks().length;
}
async function startTracking(){
 const s=trackingState;if(s.active||s.starting)return;
 if(!navigator.mediaDevices?.getUserMedia){trackingMessage('localhostまたはHTTPSで開いてください。');return}
 if(location.protocol==='file:'){trackingMessage('カメラを使うには npm run player で起動してください。');return}
 const useCamera=$('trackingInput').value!=='audio',useAudio=$('trackingInput').value!=='camera',generation=++s.generation;
 s.inputMode=$('trackingInput').value;s.starting=true;trackingUI();trackingMessage('カメラ・マイクの準備中…');
 let stream=null,worker=null,context=null;
 try{
  stream=await navigator.mediaDevices.getUserMedia({video:useCamera?{deviceId:$('cameraDevice').value?{exact:$('cameraDevice').value}:undefined,width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}}:false,audio:useAudio?{deviceId:$('microphoneDevice').value?{exact:$('microphoneDevice').value}:undefined,echoCancellation:true,noiseSuppression:true,autoGainControl:false}:false});
  if(generation!==s.generation){stream.getTracks().forEach(t=>t.stop());return}
  s.stream=stream;
  if(useAudio){context=new AudioContext();await context.resume();if(generation!==s.generation)throw Error('入力の開始を取り消しました');const analyser=context.createAnalyser();analyser.fftSize=1024;context.createMediaStreamSource(stream).connect(analyser);s.audio={context,analyser,samples:new Float32Array(analyser.fftSize)}}
  if(useCamera){
   const video=$('cameraVideo');video.srcObject=stream;await video.play();if(generation!==s.generation)throw Error('入力の開始を取り消しました');
   worker=new Worker('runtime/tracking_worker.js');s.worker=worker;
   await new Promise((resolve,reject)=>{const finish=error=>{clearTimeout(timer);if(s.cancelStart===cancel)s.cancelStart=null;error?reject(error):resolve()},cancel=()=>finish(Error('入力の開始を取り消しました')),timer=setTimeout(()=>finish(Error('追跡モデルの読み込みがタイムアウトしました')),45000);s.cancelStart=cancel;worker.onerror=()=>finish(Error('追跡Workerを起動できません'));worker.onmessage=({data})=>{if(data.type==='ready')finish();else if(data.type==='error')finish(Error(data.message))};worker.postMessage({type:'init'})});
   worker.onmessage=({data})=>{if(generation!==s.generation)return;s.busy=false;if(data.type==='result'){s.latest=data.result;s.lastResult=performance.now()}else if(data.type==='error'){trackingMessage('追跡を停止しました：'+data.message);stopTracking()}};
   worker.onerror=()=>{trackingMessage('追跡Workerが停止しました');stopTracking()};
  }
  if(generation!==s.generation){worker?.terminate();stream.getTracks().forEach(t=>t.stop());await context?.close();return}
  // Input starts only on user action; the loopback relay shares solved values only.
  captureFrame=null;s.active=true;s.starting=false;s.values=MotionClip.neutral();s.neutral={};s.latest=null;s.lastResult=0;s.lastTick=performance.now();s.lastVideo=-1;s.history=[];s.audioValue=0;s.busy=false;
  controls.headEdit.checked=false;controls.showBaseOnly.checked=false;if(!running){start=performance.now()-pausedAt*1000;if(!captureMotion)running=true;}
  for(const track of stream.getTracks())track.onended=()=>{if(s.active){trackingMessage('入力デバイスが切断されました');stopTracking()}};
  trackingMessage(useCamera?'追従中。正面を向いて「正面を合わせる」を押せます。':'マイクの音量で口パク中');trackingUI();syncCaptureUI();requestRender();await enumerateTrackingDevices();
 }catch(error){worker?.terminate();stream?.getTracks().forEach(t=>t.stop());await context?.close().catch(()=>{});if(generation===s.generation){s.active=false;s.starting=false;s.stream=null;s.worker=null;s.audio=null;trackingMessage('開始できません：'+error.message);trackingUI()}}
}
function stopTracking(){
 const s=trackingState;if(recordingActive)cancelRecording?.();if(s.recording)stopMotionTake();s.generation++;s.cancelStart?.();s.cancelStart=null;s.active=false;s.starting=false;s.worker?.terminate();s.worker=null;s.stream?.getTracks().forEach(t=>{t.onended=null;t.stop()});s.stream=null;s.audio?.context.close().catch(()=>{});s.audio=null;s.latest=null;s.values=null;s.busy=false;$('cameraVideo').srcObject=null;trackingUI();requestRender();if(typeof publishPlayerSyncLive==='function')void publishPlayerSyncLive(true);
}
function trackingTick(now){
 const s=trackingState;if(!s.active)return;
 const dt=Math.max(.001,Math.min(.1,(now-s.lastTick)/1000));s.lastTick=now;
 const solved=now-s.lastResult<350?TrackingCore.solve(s.latest,{mirror:$('cameraMirror').checked,neutral:s.neutral}):null;
 const next=MotionClip.normalize(solved||{});
 if(s.audio){s.audio.analyser.getFloatTimeDomainData(s.audio.samples);const level=TrackingCore.audioLevel(s.audio.samples,{floor:Number($('audioFloor').value),gain:Number($('audioGain').value),previous:s.audioValue,dt});s.audioValue=level.value;$('audioMeter').value=level.rms;next.mouthOpen=Math.max(next.mouthOpen,s.audioValue)}
 s.values=TrackingCore.smooth(s.values,next,dt,solved ? .06 : .2);
 s.history.push({time:(now-start)/1000,values:{...s.values}});while(s.history.length&&s.history[0].time<(now-start)/1000-4)s.history.shift();
 const video=$('cameraVideo');
 if(s.worker&&!s.busy&&video.readyState>=2&&video.currentTime!==s.lastVideo){
  s.busy=true;s.lastVideo=video.currentTime;const generation=s.generation;
  createImageBitmap(video).then(image=>{if(generation===s.generation&&s.worker)s.worker.postMessage({type:'frame',image,time:now},[image]);else image.close()}).catch(()=>{s.busy=false});
 }
 if(typeof publishPlayerSyncLive==='function')void publishPlayerSyncLive();
 if(s.recording){const elapsed=(now-s.recording.start)/1000;if(elapsed-s.recording.last>=1/30){s.recording.samples.push({time:Math.round(elapsed*1e6)/1e6,values:{...s.values}});s.recording.last=elapsed;$('takeStatus').textContent=`モーション録画中 ${elapsed.toFixed(1)} 秒`;if(elapsed>=3599)stopMotionTake()}}
}
function liveCaptureFrame(values=trackingState.values){
 if(!trackingState.active||!values)return null;
 const camera=trackingInputMode()!=='audio',allow=key=>{
  if(key.startsWith('eye')||key.startsWith('gaze'))return camera&&!$('trackingEyesOff').checked;
  if(key.startsWith('head'))return camera&&!$('trackingHeadOff').checked;
  if(key.startsWith('mouth'))return trackingInputMode()==='audio'||!$('trackingMouthOff').checked;
  return camera&&key.startsWith('brow');
 };
 return Object.fromEntries(Object.entries(values).filter(([key])=>allow(key)));
}
function startMotionTake(){const s=trackingState;if(!s.active||s.recording)return;s.recording={start:performance.now(),last:0,samples:[{time:0,values:{...s.values}}]};$('takeStatus').textContent='モーション録画中 0.0 秒';trackingUI()}
function stopMotionTake(){const s=trackingState,r=s.recording;if(!r)return;s.recording=null;const duration=Math.min(3600,Math.max(.001,(performance.now()-r.start)/1000));if(duration>r.samples.at(-1).time+.000001)r.samples.push({time:duration,values:{...s.values}});try{s.take=MotionClip.create(r.samples,{source:s.stream?.getVideoTracks().length?'camera':'microphone'});$('takeStatus').textContent=`${s.take.duration.toFixed(2)} 秒を録画しました。保存または再生できます。`}catch(e){$('takeStatus').textContent=e.message}trackingUI()}
async function saveMotionTake(){if(!trackingState.take)return;const text=JSON.stringify(trackingState.take);try{if(window.showSaveFilePicker){const handle=await showSaveFilePicker({suggestedName:'take.chibimotion.json',types:[{description:'ChibiRig Motion',accept:{'application/json':['.json']}}]});const writable=await handle.createWritable();await writable.write(text+'\n');await writable.close()}else downloadBlob(new Blob([text+'\n'],{type:'application/json'}),'take.chibimotion.json')}catch(e){if(e.name!=='AbortError')$('takeStatus').textContent='保存できません：'+e.message}}
async function enumerateTrackingDevices(){try{const devices=await navigator.mediaDevices.enumerateDevices();for(const [id,kind,label] of [['cameraDevice','videoinput','カメラ'],['microphoneDevice','audioinput','マイク']]){const el=$(id),value=el.value;el.replaceChildren(new Option('既定の'+label,''));devices.filter(d=>d.kind===kind).forEach((d,i)=>el.add(new Option(d.label||label+' '+(i+1),d.deviceId)));el.value=value}}catch{}}
function initTracking(){
 $('trackingInput').onchange=trackingUI;
 for(const id of ['trackingEyesOff','trackingMouthOff','trackingHeadOff'])$(id).onchange=()=>{trackingUI();requestRender()};
 $('cameraStart').onclick=startTracking;$('cameraStop').onclick=()=>{stopTracking();trackingMessage('入力を停止しました')};
 $('cameraCalibrate').onclick=()=>{const v=TrackingCore.solve(trackingState.latest,{mirror:false});if(v){trackingState.neutral={headYaw:v.headYaw,headPitch:v.headPitch,headRoll:v.headRoll};trackingMessage('今の向きを正面にしました')}};
 $('cameraMirror').onchange=()=>{$('cameraVideo').style.transform=$('cameraMirror').checked?'scaleX(-1)':'none'};
 $('takeRecord').onclick=startMotionTake;$('takeStop').onclick=stopMotionTake;$('takeSave').onclick=saveMotionTake;$('takePlay').onclick=()=>{const take=trackingState.take;stopTracking();loadCaptureMotion(take,'録画したモーション');$('capturePlay').click()};
 window.addEventListener('pagehide',stopTracking);navigator.mediaDevices?.addEventListener('devicechange',enumerateTrackingDevices);enumerateTrackingDevices();trackingUI();
}

function sampleLiveCapture(time){if(typeof playerSyncLiveActive==='function'&&playerSyncLiveActive())return samplePlayerSyncLive(time);const history=trackingState.history;if(!history.length)return trackingState.values;let a=history[0];for(const b of history){if(b.time>=time){const u=b.time===a.time?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));return Object.fromEntries(Object.keys(a.values).map(k=>[k,a.values[k]+(b.values[k]-a.values[k])*u]))}a=b}return a.values}
