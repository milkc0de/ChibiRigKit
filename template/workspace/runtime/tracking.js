// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
const trackingState={active:false,starting:false,inputMode:null,generation:0,stream:null,worker:null,workerToken:0,delegate:null,workerRecovering:false,workerRestarts:0,workerRetryAt:0,busy:false,busySince:0,cancelStart:null,lastResult:0,lastTick:0,lastVideo:-1,lastVideoProgress:0,healthTimer:null,inputs:null,recovery:null,desktopCapture:null,history:[],neutral:{},latest:null,values:null,audio:null,audioValue:0,take:null,recording:null};
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
function createTrackingAudio(context,stream){
 const source=context.createMediaStreamSource(stream),channels=Math.max(1,Math.min(8,stream.getAudioTracks?.()[0]?.getSettings?.().channelCount||2)),splitter=context.createChannelSplitter(channels),silent=context.createGain();
 // Keep the graph processing without playing the captured sound through speakers.
 silent.gain.value=0;source.connect(splitter);
 const analysers=Array.from({length:channels},(_,channel)=>{const analyser=context.createAnalyser();analyser.fftSize=1024;splitter.connect(analyser,channel);analyser.connect(silent);return {analyser,samples:new Float32Array(analyser.fftSize)}});
 silent.connect(context.destination);return {context,source,splitter,silent,analysers,started:performance.now(),heard:false};
}
function readTrackingAudio(audio,options){
 // Measure channels before mixing: opposite-phase stereo must not cancel to silence.
 const levels=audio.analysers.map(({analyser,samples})=>{analyser.getFloatTimeDomainData(samples);return TrackingCore.audioLevel(samples,options)});
 return {rms:Math.max(...levels.map(x=>x.rms)),value:Math.max(...levels.map(x=>x.value))};
}
function trackingTracks(kind){return (kind==='video'?trackingState.stream?.getVideoTracks?.():trackingState.stream?.getAudioTracks?.())||[]}
function trackingTrackIsLive(track){return track&&track.readyState!=='ended'}
function updateDesktopCapture(){
 const s=trackingState,active=s.active&&['video','audio'].some(kind=>trackingTracks(kind).some(trackingTrackIsLive));
 if(s.desktopCapture===active)return;s.desktopCapture=active;
 try{Promise.resolve(window.chibiDesktop?.setCaptureActive?.(active)).catch(()=>{})}catch{}
}
function disposeTrackingAudio(audio){
 if(!audio)return;audio.context.onstatechange=null;
 for(const node of [audio.source,audio.splitter,audio.silent,...audio.analysers.map(x=>x.analyser)])try{node?.disconnect?.()}catch{}
 try{Promise.resolve(audio.context.close()).catch(()=>{})}catch{}
}
function bindTrackingTrack(track,kind){
 const s=trackingState,generation=s.generation;
 track.onended=()=>{if(s.active&&generation===s.generation){updateDesktopCapture();void recoverTrackingInput(kind)}};
 track.onmute=()=>{if(s.active&&generation===s.generation&&s.recovery[kind])s.recovery[kind].mutedAt=performance.now()};
 track.onunmute=()=>{if(s.active&&generation===s.generation){s.recovery[kind].mutedAt=0;resumeTrackingInputs()}};
}
function bindTrackingAudio(audio){
 audio.context.onstatechange=()=>{if(trackingState.active&&trackingState.audio===audio)void resumeTrackingAudio()};
}
async function resumeTrackingAudio(){
 const s=trackingState;if(!s.active)return;
 if(!s.audio&&s.inputs?.audio&&trackingTracks('audio').some(trackingTrackIsLive)){
  const now=performance.now();if(s.audioRebuilding||now<(s.audioRetryAt||0))return;
  const generation=s.generation;s.audioRebuilding=true;
  try{const context=new AudioContext();s.audio=createTrackingAudio(context,s.stream);bindTrackingAudio(s.audio);await context.resume();if(!s.active||generation!==s.generation)disposeTrackingAudio({context,analysers:[]})}
  catch{s.audioRetryAt=now+2000}
  finally{if(generation===s.generation)s.audioRebuilding=false}
  return;
 }
 const audio=s.audio;if(!audio||audio.resuming)return;
 if(audio.context.state!=='suspended'&&audio.context.state!=='interrupted'&&audio.context.state!=='closed')return;
 const now=performance.now();if(audio.resumeAttempt&&now-audio.resumeAttempt<1000)return;audio.resumeAttempt=now;audio.resuming=true;
 const generation=s.generation;
 try{
  if(audio.context.state==='closed'){
   if(!trackingTracks('audio').some(trackingTrackIsLive))return;
   const context=new AudioContext();await context.resume();
   if(!s.active||generation!==s.generation||s.audio!==audio){await context.close().catch(()=>{});return}
   disposeTrackingAudio(audio);s.audio=createTrackingAudio(context,s.stream);bindTrackingAudio(s.audio);
  }else await audio.context.resume();
 }catch{if(s.audio===audio&&$('audioStatus'))$('audioStatus').textContent='音声の再開を待っています。操作画面をクリックすると再開できます。'}
 finally{audio.resuming=false}
}
function createTrackingWorker(generation){
 const s=trackingState,worker=new Worker('runtime/tracking_worker.js'),token=++s.workerToken;s.worker=worker;s.busy=false;s.busySince=0;
 return new Promise((resolve,reject)=>{
  let settled=false;
  const current=()=>generation===s.generation&&s.worker===worker&&token===s.workerToken;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);if(s.cancelStart===cancel)s.cancelStart=null;if(error){if(s.worker===worker)s.worker=null;worker.terminate();reject(error)}else resolve(worker)};
  const cancel=()=>finish(Error('入力の開始を取り消しました'));
  const timer=setTimeout(()=>finish(Error('追跡モデルの読み込みがタイムアウトしました')),45000);
  s.cancelStart=cancel;
  worker.onerror=()=>{if(!current())return;if(!settled)finish(Error('追跡Workerを起動できません'));else trackingWorkerFailed('追跡Workerが停止しました')};
  worker.onmessage=({data})=>{
   if(!current())return;
   if(!settled){if(data.type==='ready'){s.delegate=data.delegate||null;finish();}else if(data.type==='error')finish(Error(data.message));return}
   if(data.type==='result'){if(data.delegate&&data.delegate!==s.delegate){s.delegate=data.delegate;if(data.delegate==='CPU')trackingMessage('CPUで追従中。GPUの停止から復帰しました。')}s.busy=false;s.busySince=0;s.latest=data.result;s.lastResult=performance.now();s.workerRestarts=0}
   else if(data.type==='error')trackingWorkerFailed(data.message);
  };
  try{worker.postMessage({type:'init'})}catch(error){finish(error)}
 });
}
function trackingWorkerFailed(message){
 const s=trackingState;if(!s.active)return;
 s.worker?.terminate();s.worker=null;s.workerToken++;s.busy=false;s.busySince=0;s.latest=null;
 s.workerRetryAt=performance.now()+1000;
 trackingMessage('カメラの追跡を再開しています…'+(s.audio?' マイク入力は継続中です。':''));
 if(s.workerRestarts>=3)trackingMessage('カメラの追跡を再開できません：'+message+'。停止して追従開始を押し直してください。'+(s.audio?' マイク入力は継続中です。':''));
}
async function recoverTrackingWorker(){
 const s=trackingState;if(!s.active||s.workerRecovering||s.worker||s.workerRestarts>=3||!trackingTracks('video').some(trackingTrackIsLive)||performance.now()<s.workerRetryAt)return;
 const generation=s.generation;s.workerRecovering=true;s.workerRestarts++;
 try{await createTrackingWorker(generation);if(s.active&&generation===s.generation)trackingMessage('カメラの追跡を再開しました。')}
 catch(error){if(s.active&&generation===s.generation){s.workerRetryAt=performance.now()+Math.min(30000,1000*2**s.workerRestarts);trackingMessage('カメラの追跡を再開できません：'+error.message+(s.audio?'。マイク入力は継続中です。':''))}}
 finally{if(generation===s.generation)s.workerRecovering=false}
}
async function trackingPermissionGranted(kind){
 // An automatic recovery must never open another permission prompt.
 try{return (await navigator.permissions?.query({name:kind==='video'?'camera':'microphone'}))?.state==='granted'}catch{return false}
}
async function recoverTrackingInput(kind){
 const s=trackingState,r=s.recovery?.[kind];if(!s.active||!r||r.pending||r.blocked||performance.now()<r.retryAt)return;
 const generation=s.generation,label=kind==='video'?'カメラ':'マイク';r.pending=true;
 try{
  if(!await trackingPermissionGranted(kind)){
   if(s.active&&generation===s.generation){r.blocked=true;trackingMessage(label+'の入力が途切れました。停止して追従開始を押し直してください。他の入力は継続します。')}return;
  }
  if(!s.active||generation!==s.generation)return;
  const extra=await navigator.mediaDevices.getUserMedia({video:kind==='video'?s.inputs.video:false,audio:kind==='audio'?s.inputs.audio:false});
  if(!s.active||generation!==s.generation){extra.getTracks().forEach(t=>t.stop());return}
  const replacement=(kind==='video'?extra.getVideoTracks():extra.getAudioTracks())[0];
  if(!replacement){extra.getTracks().forEach(t=>t.stop());throw Error('入力トラックがありません')}
  for(const old of trackingTracks(kind)){old.onended=null;old.onmute=null;old.onunmute=null;s.stream.removeTrack(old);old.stop()}
  for(const track of extra.getTracks()){if(track!==replacement)track.stop()}
  s.stream.addTrack(replacement);bindTrackingTrack(replacement,kind);r.retryAt=0;r.failures=0;r.mutedAt=0;
  if(kind==='video'){
   s.lastVideo=-1;s.lastVideoProgress=performance.now();$('cameraVideo').srcObject=s.stream;await $('cameraVideo').play();
   if(s.active&&generation===s.generation)void recoverTrackingWorker();
  }else{
   disposeTrackingAudio(s.audio);s.audio=null;s.audioValue=0;
   const context=new AudioContext();s.audio=createTrackingAudio(context,s.stream);bindTrackingAudio(s.audio);await context.resume();
   if(!s.active||generation!==s.generation){await context.close().catch(()=>{});return}
  }
  if(s.active&&generation===s.generation){trackingMessage(label+'の入力を再開しました。');trackingUI();updateDesktopCapture()}
 }catch(error){if(s.active&&generation===s.generation){r.failures++;r.retryAt=performance.now()+Math.min(30000,1000*2**Math.min(5,r.failures));if(error.name==='NotAllowedError'||error.name==='SecurityError')r.blocked=true;trackingMessage(label+'の再接続を待っています：'+error.message+'。他の入力は継続します。')}}
 finally{r.pending=false}
}
function trackingHealthTick(now=performance.now()){
 const s=trackingState;if(!s.active)return;
 if(s.inputs.audio)void resumeTrackingAudio();
 for(const kind of ['video','audio'])if(s.inputs[kind]){
  const tracks=trackingTracks(kind),r=s.recovery[kind];
  if(!tracks.some(trackingTrackIsLive)||(r.mutedAt&&now-r.mutedAt>10000))void recoverTrackingInput(kind);
 }
 if(s.inputs.video&&trackingTracks('video').some(trackingTrackIsLive)){
  const video=$('cameraVideo');
  if(video.currentTime!==s.healthVideoTime){s.healthVideoTime=video.currentTime;s.lastVideoProgress=now}
  if(video.paused||now-s.lastVideoProgress>4000){try{Promise.resolve(video.play()).catch(()=>{})}catch{}}
  if(now-s.lastVideoProgress>10000)void recoverTrackingInput('video');
  if(s.busy&&now-s.busySince>8000)trackingWorkerFailed('映像の処理がタイムアウトしました');
  if(!s.worker)void recoverTrackingWorker();
 }
 updateDesktopCapture();
}
function resumeTrackingInputs(){
 const s=trackingState;if(!s.active)return;s.lastTick=performance.now();s.lastVideoProgress=s.lastTick;
 if(s.inputs.video){try{Promise.resolve($('cameraVideo').play()).catch(()=>{})}catch{}}
 void resumeTrackingAudio();trackingHealthTick();requestRender();
}
async function startTracking(){
 const s=trackingState;if(s.active||s.starting)return;
 if(!navigator.mediaDevices?.getUserMedia){trackingMessage('localhostまたはHTTPSで開いてください。');return}
 if(location.protocol==='file:'){trackingMessage('カメラ・音声は完成品の START_SERVER で起動し、操作用URLをブラウザで開いてください。');return}
 const useCamera=$('trackingInput').value!=='audio',useAudio=$('trackingInput').value!=='camera',generation=++s.generation;
 s.inputMode=$('trackingInput').value;s.starting=true;trackingUI();trackingMessage('カメラ・マイクの準備中…');
 let stream=null,worker=null,context=null;
 try{
  // Create/resume during the user's click, before awaiting device permission.
  if(useAudio){context=new AudioContext();await context.resume();if(context.state==='suspended')throw Error('音声処理が一時停止中です。操作画面で追従開始を押し直してください')}
  if(useCamera){
   let capabilities;try{const response=await fetch('/api/tracking');if(response.ok)capabilities=await response.json()}catch{}
   if(!capabilities)throw Error('追跡に対応したサーバーではありません。最新の完成品ZIPをすべて展開してSTART_SERVERを起動してください');
   if(!capabilities.camera){
    if(generation!==s.generation)throw Error('入力の開始を取り消しました');
    trackingMessage('不足している追跡ファイルをダウンロードしています…（初回はインターネット接続が必要です）');
    let response;try{response=await fetch('/api/tracking/setup',{method:'POST',headers:{'X-ChibiRig-Token':capabilities.setupToken}})}catch{throw Error('追跡ファイルを取得できません。インターネット接続を確認して再度開始してください')}
    const result=await response.json();if(!response.ok||!result.camera)throw Error(result.error||'追跡ファイルを準備できませんでした');
   }
  }
  if(generation!==s.generation)throw Error('入力の開始を取り消しました');
  s.inputs={video:useCamera?{deviceId:$('cameraDevice').value?{exact:$('cameraDevice').value}:undefined,width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}}:false,audio:useAudio?{deviceId:$('microphoneDevice').value?{exact:$('microphoneDevice').value}:undefined,echoCancellation:false,noiseSuppression:false,autoGainControl:false}:false};
  stream=await navigator.mediaDevices.getUserMedia(s.inputs);
  if(generation!==s.generation){stream.getTracks().forEach(t=>t.stop());await context?.close().catch(()=>{});return}
  s.stream=stream;
  // Keep recovery on the device the user started, even if the OS default changes.
  for(const kind of ['video','audio']){const deviceId=trackingTracks(kind)[0]?.getSettings?.().deviceId;if(s.inputs[kind]&&deviceId)s.inputs[kind].deviceId={exact:deviceId}}
  if(useAudio){s.audio=createTrackingAudio(context,stream);bindTrackingAudio(s.audio)}
  if(useCamera){
   const video=$('cameraVideo');video.srcObject=stream;await video.play();if(generation!==s.generation)throw Error('入力の開始を取り消しました');
   worker=await createTrackingWorker(generation);
  }
  if(generation!==s.generation){worker?.terminate();stream.getTracks().forEach(t=>t.stop());await context?.close().catch(()=>{});return}
  // Input starts only on user action; the loopback relay shares solved values only.
  captureFrame=null;s.active=true;s.starting=false;s.values=MotionClip.neutral();s.neutral={};s.latest=null;s.lastResult=0;s.lastTick=performance.now();s.lastVideo=-1;s.lastVideoProgress=s.lastTick;s.healthVideoTime=$('cameraVideo').currentTime;s.history=[];s.audioValue=0;s.audioRebuilding=false;s.audioRetryAt=0;s.busy=false;s.busySince=0;s.workerRestarts=0;s.workerRetryAt=0;s.workerRecovering=false;
  s.recovery={video:{pending:false,blocked:false,retryAt:0,failures:0,mutedAt:0},audio:{pending:false,blocked:false,retryAt:0,failures:0,mutedAt:0}};
  controls.headEdit.checked=false;controls.showBaseOnly.checked=false;if(!running){start=performance.now()-pausedAt*1000;if(!captureMotion)running=true;}
  for(const kind of ['video','audio'])for(const track of trackingTracks(kind))bindTrackingTrack(track,kind);
  clearInterval(s.healthTimer);s.healthTimer=setInterval(()=>trackingHealthTick(),1000);updateDesktopCapture();
  trackingMessage(useCamera?'追従中'+(s.delegate?'（'+s.delegate+'）':'')+'。正面を向いて「正面を合わせる」を押せます。':'マイクの音量で口パク中');trackingUI();syncCaptureUI();requestRender();await enumerateTrackingDevices();
 }catch(error){worker?.terminate();stream?.getTracks().forEach(t=>t.stop());await context?.close().catch(()=>{});if(generation===s.generation){s.active=false;s.starting=false;s.stream=null;s.worker=null;s.audio=null;s.inputs=null;updateDesktopCapture();trackingMessage('開始できません：'+error.message);trackingUI()}}
}
function stopTracking(){
 const s=trackingState;if(recordingActive)cancelRecording?.();if(s.recording)stopMotionTake();s.generation++;s.cancelStart?.();s.cancelStart=null;s.active=false;s.starting=false;clearInterval(s.healthTimer);s.healthTimer=null;s.worker?.terminate();s.worker=null;s.delegate=null;s.workerToken++;s.workerRecovering=false;s.stream?.getTracks().forEach(t=>{t.onended=null;t.onmute=null;t.onunmute=null;t.stop()});s.stream=null;disposeTrackingAudio(s.audio);s.audio=null;s.audioValue=0;s.inputs=null;s.recovery=null;$('audioMeter').value=0;if($('audioStatus'))$('audioStatus').textContent='入力を停止しました';s.latest=null;s.values=null;s.busy=false;s.busySince=0;$('cameraVideo').srcObject=null;updateDesktopCapture();trackingUI();requestRender();if(typeof publishPlayerSyncLive==='function')void publishPlayerSyncLive(true);
}
function trackingTick(now){
 const s=trackingState;if(!s.active)return;
 const dt=Math.max(.001,Math.min(.1,(now-s.lastTick)/1000));s.lastTick=now;
 const solved=now-s.lastResult<350?TrackingCore.solve(s.latest,{mirror:$('cameraMirror').checked,neutral:s.neutral}):null;
 const next=MotionClip.normalize(solved||{});
 if(s.audio){const level=readTrackingAudio(s.audio,{floor:Number($('audioFloor').value),gain:Number($('audioGain').value),previous:s.audioValue,dt});s.audioValue=level.value;$('audioMeter').value=level.rms;next.mouthOpen=Math.max(next.mouthOpen,s.audioValue);
  if(level.rms>.0001)s.audio.heard=true;
  const status=$('audioStatus');if(status){const db=level.rms>0?Math.max(-96,20*Math.log10(level.rms)).toFixed(1)+' dBFS':'無音';status.textContent=s.audio.context.state!=='running'?'音声処理を再開しています。再開しない場合は操作画面をクリックしてください。':(!s.audio.heard&&now-s.audio.started>2500?'入力音量が届いていません。再生アプリの出力先と、選択したマイクを確認してください。':'入力音量：'+db+(level.rms>0&&level.rms<=Number($('audioFloor').value)?'（無音とみなす音量以下）':''))}}

 s.values=(solved||s.audio)&&TrackingCore.adaptiveSmooth?TrackingCore.adaptiveSmooth(s.values,next,dt,{seconds:.06}):TrackingCore.smooth(s.values,next,dt,solved ? .06 : .2);
 s.history.push({time:(now-start)/1000,values:{...s.values}});while(s.history.length&&s.history[0].time<(now-start)/1000-4)s.history.shift();
 const video=$('cameraVideo');
 if(s.worker&&!s.busy&&video.readyState>=2&&video.currentTime!==s.lastVideo){
  s.busy=true;s.busySince=now;s.lastVideo=video.currentTime;s.lastVideoProgress=now;const generation=s.generation,worker=s.worker;
  createImageBitmap(video).then(image=>{if(generation===s.generation&&s.worker===worker){try{worker.postMessage({type:'frame',image,time:now},[image])}catch{image.close();trackingWorkerFailed('映像を追跡処理へ送れません')}}else image.close()}).catch(()=>{if(generation===s.generation&&s.worker===worker){s.busy=false;s.busySince=0}});
 }
 if(typeof publishPlayerSyncLive==='function')void publishPlayerSyncLive();
 if(s.recording){const elapsed=(now-s.recording.start)/1000;if(elapsed-s.recording.last>=1/30){s.recording.samples.push({time:Math.round(elapsed*1e6)/1e6,values:{...s.values}});s.recording.last=elapsed;$('takeStatus').textContent=`モーション録画中 ${elapsed.toFixed(1)} 秒`;if(elapsed>=3599)stopMotionTake()}}
}
function liveCaptureFrame(values=trackingState.values){
 if(!trackingState.active||!values)return null;
 const camera=trackingInputMode()!=='audio',allow=key=>{
  if(key.startsWith('eye')||key.startsWith('gaze'))return camera&&!$('trackingEyesOff').checked;
  if(key.startsWith('head')||key.startsWith('body'))return camera&&!$('trackingHeadOff').checked;
  if(key.startsWith('mouth'))return trackingInputMode()==='audio'||!$('trackingMouthOff').checked;
  return camera&&key.startsWith('brow');
 };
 return Object.fromEntries(Object.entries(values).filter(([key])=>allow(key)));
}
function startMotionTake(){const s=trackingState;if(!s.active||s.recording)return;s.recording={start:performance.now(),last:0,samples:[{time:0,values:{...s.values}}]};$('takeStatus').textContent='モーション録画中 0.0 秒';trackingUI()}
function stopMotionTake(){const s=trackingState,r=s.recording;if(!r)return;s.recording=null;const duration=Math.min(3600,Math.max(.001,(performance.now()-r.start)/1000));if(duration>r.samples.at(-1).time+.000001)r.samples.push({time:duration,values:{...s.values}});try{s.take=MotionClip.create(r.samples,{source:s.stream?.getVideoTracks().length?'camera':'microphone'});$('takeStatus').textContent=`${s.take.duration.toFixed(2)} 秒を録画しました。保存または再生できます。`}catch(e){$('takeStatus').textContent=e.message}trackingUI()}
async function saveMotionTake(){if(!trackingState.take)return;const text=JSON.stringify(trackingState.take);try{if(window.showSaveFilePicker&&!window.chibiDesktop){const handle=await showSaveFilePicker({suggestedName:'take.chibimotion.json',types:[{description:'ChibiRig Motion',accept:{'application/json':['.json']}}]});const writable=await handle.createWritable();await writable.write(text+'\n');await writable.close()}else downloadBlob(new Blob([text+'\n'],{type:'application/json'}),'take.chibimotion.json')}catch(e){if(e.name!=='AbortError')$('takeStatus').textContent='保存できません：'+e.message}}
async function enumerateTrackingDevices(){try{const devices=await navigator.mediaDevices.enumerateDevices();for(const [id,kind,label] of [['cameraDevice','videoinput','カメラ'],['microphoneDevice','audioinput','マイク']]){const el=$(id),value=el.value;el.replaceChildren(new Option('既定の'+label,''));devices.filter(d=>d.kind===kind).forEach((d,i)=>el.add(new Option(d.label||label+' '+(i+1),d.deviceId)));el.value=value}}catch{}}
function initTracking(){
 $('trackingInput').onchange=trackingUI;
 for(const id of ['trackingEyesOff','trackingMouthOff','trackingHeadOff'])$(id).onchange=()=>{trackingUI();requestRender()};
 $('cameraStart').onclick=startTracking;$('cameraStop').onclick=()=>{stopTracking();trackingMessage('入力を停止しました')};
 $('cameraCalibrate').onclick=()=>{const v=TrackingCore.solve(trackingState.latest,{mirror:false});if(v){trackingState.neutral={headYaw:v.headYaw,headPitch:v.headPitch,headRoll:v.headRoll};trackingMessage('今の向きを正面にしました')}};
 $('cameraMirror').onchange=()=>{$('cameraVideo').style.transform=$('cameraMirror').checked?'scaleX(-1)':'none'};
 $('takeRecord').onclick=startMotionTake;$('takeStop').onclick=stopMotionTake;$('takeSave').onclick=saveMotionTake;$('takePlay').onclick=()=>{const take=trackingState.take;stopTracking();loadCaptureMotion(take,'録画したモーション');$('capturePlay').click()};
 window.addEventListener('pagehide',event=>{if(!event.persisted)stopTracking()});
 window.addEventListener('pageshow',resumeTrackingInputs);document.addEventListener('resume',resumeTrackingInputs);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumeTrackingInputs()});
 for(const event of ['pointerdown','keydown'])document.addEventListener(event,()=>{if(trackingState.active)void resumeTrackingAudio()});
 window.chibiDesktop?.onResume?.(resumeTrackingInputs);
 navigator.mediaDevices?.addEventListener('devicechange',()=>{enumerateTrackingDevices();trackingHealthTick()});enumerateTrackingDevices();trackingUI();
}

function sampleLiveCapture(time){if(typeof playerSyncLiveActive==='function'&&playerSyncLiveActive())return samplePlayerSyncLive(time);const history=trackingState.history;if(!history.length)return trackingState.values;let a=history[0];for(const b of history){if(b.time>=time){const u=b.time===a.time?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));return Object.fromEntries(Object.keys(a.values).map(k=>[k,a.values[k]+(b.values[k]-a.values[k])*u]))}a=b}return a.values}
