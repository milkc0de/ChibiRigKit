// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
let recordingActive=false,cancelRecording=null;
function recordingProgress(elapsed,duration){return `録画中 ${Math.min(duration,Math.max(0,elapsed)).toFixed(1)} / ${duration.toFixed(1)} 秒`}
async function recordLoop(){
  if(recordingActive)return;
  const button=$('record'),status=$('recordStatus'),progress=$('recordProgress');
  if(!outputCanvas.captureStream||!window.MediaRecorder){status.textContent='このブラウザは録画に対応していません。Chromeで開いてください。';return}
  const duration=Number(controls.duration.value);
  if(!Number.isFinite(duration)||duration<1||duration>60){status.textContent='ループ秒数は1〜60秒で指定してください。';return}
  const live=trackingState.active;
  const previous={time:running?(performance.now()-start)/1000:pausedAt,running,captureOffset,capturePlaying,captureHold},disabled=[];
  let stream,recorder,timer,stopTimer,cancelled=false;
  recordingActive=true;
  for(const element of document.querySelectorAll('aside input,aside button,aside select')){if(element.id==='cameraStop')continue;disabled.push([element,element.disabled]);element.disabled=true}
  $('recordCancel').hidden=false;$('recordCancel').disabled=false;
  progress.hidden=false;progress.max=duration;progress.value=0;button.textContent='録画中…';
  try{
    if(!live){captureOffset=0;captureHold=0;capturePlaying=!!captureMotion;start=performance.now();pausedAt=0;running=true;render(0)}else render(captureTime());
    stream=outputCanvas.captureStream(30);
    const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    if(!mime)throw Error('WebM形式で録画できません');
    recorder=new MediaRecorder(stream,{mimeType:mime});const chunks=[];
    const done=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=e=>reject(e.error||Error('録画に失敗しました'));recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}});
    cancelRecording=()=>{cancelled=true;status.textContent='録画を中止しています…';if(recorder.state!=='inactive')recorder.stop()};
    recorder.start();const began=performance.now();
    const update=()=>{const elapsed=(performance.now()-began)/1000;progress.value=Math.min(duration,elapsed);status.textContent=recordingProgress(elapsed,duration)};
    update();timer=setInterval(update,100);
    stopTimer=setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop()},duration*1000);
    await done;
    if(cancelled){status.textContent='録画を中止しました（動画は保存していません）';return}
    const blob=new Blob(chunks,{type:mime});if(!blob.size)throw Error('録画データが空でした');
    downloadBlob(blob,'chibirig-output.webm');progress.value=duration;status.textContent=`録画完了 ${duration.toFixed(1)} / ${duration.toFixed(1)} 秒（WebMを保存）`;
  }catch(error){status.textContent=`録画できません：${error.message}`}
  finally{
    clearInterval(timer);clearTimeout(stopTimer);
    if(recorder&&recorder.state!=='inactive')recorder.stop();stream?.getTracks().forEach(track=>track.stop());
    if(!live){captureOffset=previous.captureOffset;capturePlaying=previous.capturePlaying;captureHold=previous.captureHold;start=performance.now()-previous.time*1000;pausedAt=previous.time;running=previous.running;}
    for(const [element,value] of disabled)element.disabled=value;
    recordingActive=false;if(typeof trackingUI==='function')trackingUI();cancelRecording=null;$('recordCancel').hidden=true;button.textContent='WebM録画';render(live?captureTime():previous.time);
  }
}
$('record').onclick=recordLoop;

$('recordCancel').onclick=()=>cancelRecording?.();
