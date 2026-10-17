// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {browserHarness}=require('./browser-harness.cjs');
const run=(f,code)=>vm.runInContext(code,f.context);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function track(kind,id=kind){return {kind,readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended'},getSettings:()=>({deviceId:id,channelCount:1})}}
function stream(...tracks){return {tracks,getTracks(){return this.tracks.slice()},getVideoTracks(){return this.tracks.filter(x=>x.kind==='video')},getAudioTracks(){return this.tracks.filter(x=>x.kind==='audio')},addTrack(t){this.tracks.push(t)},removeTrack(t){this.tracks=this.tracks.filter(x=>x!==t)}}}
async function fixture(mode='camera_audio'){
 const f=browserHarness();await f.context.rigReady;f.elements.get('trackingInput').value=mode;
 const devices=stream(...(mode==='audio'?[]:[track('video','selected-camera')]),...(mode==='camera'?[]:[track('audio','selected-microphone')]));
 const workers=[],contexts=[],constraints=[],desktop=[];let now=1000;
 f.context.performance.now=()=>now;f.now=value=>now=value;
 f.context.AudioContext=class{
  constructor(){this.state='running';this.destination={};this.resumes=0;this.closes=0;contexts.push(this)}
  async resume(){this.resumes++;this.state='running'}
  async close(){this.closes++;this.state='closed'}
  createMediaStreamSource(){return {connect(){},disconnect(){}}}
  createChannelSplitter(){return {connect(){},disconnect(){}}}
  createAnalyser(){return {connect(){},disconnect(){},getFloatTimeDomainData(buffer){buffer.fill(.2)}}}
  createGain(){return {gain:{value:1},connect(){},disconnect(){}}}
 };
 f.context.Worker=class{
  constructor(){workers.push(this)}
  postMessage(data){if(data.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}))}
  terminate(){this.terminated=true}
 };
 f.context.navigator.permissions={query:async()=>({state:'granted'})};
 f.context.navigator.mediaDevices.getUserMedia=async request=>{constraints.push(request);return devices};
 f.context.chibiDesktop={setCaptureActive:active=>desktop.push(active)};
 Object.assign(f.elements.get('cameraVideo'),{currentTime:1,readyState:2,paused:false});
 await f.context.startTracking();assert.equal(run(f,'trackingState.active'),true);
 return Object.assign(f,{devices,workers,contexts,constraints,desktop});
}
test('a suspended microphone resumes without reopening devices or interrupting the camera',async()=>{
 const f=await fixture(),audio=f.contexts[0],camera=f.devices.getVideoTracks()[0];
 audio.state='suspended';audio.onstatechange();await flush();
 assert.equal(audio.state,'running');assert.equal(audio.resumes,2);assert.equal(f.constraints.length,1);assert.equal(camera.stops,0);assert.equal(run(f,'trackingState.active'),true);
 f.context.stopTracking();assert.deepEqual(f.desktop,[true,false]);
});
test('an ended camera reconnects only that granted device while the microphone continues',async()=>{
 const f=await fixture(),camera=f.devices.getVideoTracks()[0],microphone=f.devices.getAudioTracks()[0],replacement=track('video','selected-camera');
 let request;f.context.navigator.mediaDevices.getUserMedia=async value=>{request=value;return stream(replacement)};
 camera.readyState='ended';camera.onended();await flush();
 assert.equal(request.video.deviceId.exact,'selected-camera');assert.equal(request.audio,false);assert.equal(f.devices.getVideoTracks()[0],replacement);assert.equal(microphone.stops,0);assert.equal(f.contexts[0].closes,0);assert.equal(run(f,'trackingState.active'),true);f.context.stopTracking();
});
test('revoked permission never opens an automatic device prompt and leaves the other input running',async()=>{
 const f=await fixture();let requests=0;f.context.navigator.permissions.query=async()=>({state:'prompt'});f.context.navigator.mediaDevices.getUserMedia=async()=>{requests++;throw Error('must not prompt')};
 const camera=f.devices.getVideoTracks()[0];camera.readyState='ended';camera.onended();await flush();f.context.trackingHealthTick();await flush();
 assert.equal(requests,0);assert.equal(f.devices.getAudioTracks()[0].stops,0);assert.match(f.elements.get('trackingStatus').textContent,/停止して追従開始/);assert.equal(run(f,'trackingState.active'),true);f.context.stopTracking();
});
test('stop during reconnection disposes late replacement tracks and never restarts capture',async()=>{
 const f=await fixture(),camera=f.devices.getVideoTracks()[0],replacement=track('video');let finish;
 f.context.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>finish=resolve);
 camera.readyState='ended';camera.onended();await flush();assert.ok(finish);f.context.stopTracking();finish(stream(replacement));await flush();
 assert.equal(replacement.stops,1);assert.equal(run(f,'trackingState.active'),false);assert.equal(run(f,'trackingState.stream'),null);f.context.resumeTrackingInputs();assert.equal(run(f,'trackingState.active'),false);assert.deepEqual(f.desktop,[true,false]);
});
test('hung and failed workers recover independently and stale worker replies cannot replace live results',async()=>{
 const f=await fixture(),old=f.workers[0];run(f,'trackingState.busy=true;trackingState.busySince=1000');f.now(10000);f.context.trackingHealthTick();
 assert.equal(old.terminated,true);assert.equal(f.devices.getAudioTracks()[0].stops,0);assert.equal(run(f,'trackingState.active'),true);
 f.now(12000);f.context.trackingHealthTick();await flush();assert.equal(f.workers.length,2);
 old.onmessage({data:{type:'result',result:{stale:true}}});assert.equal(run(f,'trackingState.latest'),null);
 f.workers[1].onmessage({data:{type:'result',result:{fresh:true}}});assert.equal(run(f,'trackingState.latest.fresh'),true);f.context.stopTracking();
});
test('microphone reconnection preserves the camera and replaces the audio graph',async()=>{
 const f=await fixture(),microphone=f.devices.getAudioTracks()[0],camera=f.devices.getVideoTracks()[0],replacement=track('audio');let request;
 f.context.navigator.mediaDevices.getUserMedia=async value=>{request=value;return stream(replacement)};
 microphone.readyState='ended';microphone.onended();await flush();
 assert.equal(request.video,false);assert.equal(request.audio.deviceId.exact,'selected-microphone');assert.equal(camera.stops,0);assert.equal(f.workers[0].terminated,undefined);assert.equal(f.contexts[0].closes,1);assert.equal(f.contexts.length,2);assert.equal(f.devices.getAudioTracks()[0],replacement);f.context.stopTracking();
});
test('camera stalls recover after a grace period while a closed audio context rebuilds without device access',async()=>{
 const f=await fixture(),replacement=track('video');let requests=0;
 f.context.navigator.mediaDevices.getUserMedia=async()=>{requests++;return stream(replacement)};
 f.contexts[0].state='closed';await f.context.resumeTrackingAudio();assert.equal(f.contexts.length,2);assert.equal(requests,0);assert.equal(f.contexts[1].state,'running');
 f.now(6000);f.context.trackingHealthTick();await flush();assert.equal(requests,0);
 f.now(12000);f.context.trackingHealthTick();await flush();assert.equal(requests,1);assert.equal(f.devices.getVideoTracks()[0],replacement);assert.equal(f.contexts[1].closes,0);f.context.stopTracking();
});
test('desktop resume and restored pages wake inputs, and a real page exit stops capture',async()=>{
 const f=await fixture(),windowEvents={},documentEvents={};let desktopResume,plays=0;
 f.context.addEventListener=(event,fn)=>windowEvents[event]=fn;f.context.document.addEventListener=(event,fn)=>documentEvents[event]=fn;
 f.context.chibiDesktop.onResume=fn=>{desktopResume=fn;return ()=>{}};f.elements.get('cameraVideo').play=async()=>{plays++};f.context.initTracking();
 f.contexts[0].state='suspended';desktopResume();await flush();assert.equal(f.contexts[0].state,'running');assert.ok(plays>0);
 windowEvents.pagehide({persisted:true});assert.equal(run(f,'trackingState.active'),true);windowEvents.pageshow();documentEvents.resume();
 f.context.document.visibilityState='visible';documentEvents.visibilitychange();assert.ok(plays>=4);
 windowEvents.pagehide({persisted:false});assert.equal(run(f,'trackingState.active'),false);const count=plays;desktopResume();assert.equal(plays,count);
});
test('GPU context loss retries the same frame on CPU and releases its bitmap',async()=>{
 const messages=[],delegates=[];let closed=0,gpuClosed=0;
 const context=vm.createContext({URL,importScripts(){},Vision:{FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:async(_files,options)=>{const delegate=options.baseOptions.delegate;delegates.push(delegate);return delegate==='GPU'?{detectForVideo(){throw Error('WebGL context lost')},close(){gpuClosed++}}:{detectForVideo:(_image,time)=>({time}),close(){}}}}},self:{location:{href:'http://localhost/runtime/tracking_worker.js'},postMessage:message=>messages.push(message)}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../template/workspace/runtime/tracking_worker.js'),'utf8'),context);
 await context.self.onmessage({data:{type:'init'}});await context.self.onmessage({data:{type:'frame',time:1000,image:{close(){closed++}}}});
 assert.deepEqual(delegates,['GPU','CPU']);assert.equal(messages.at(-1).type,'result');assert.equal(messages.at(-1).delegate,'CPU');assert.equal(messages.at(-1).result.time,1000);assert.equal(closed,1);assert.equal(gpuClosed,1);
});
test('desktop saves motion through downloads without requesting File System Access permission',async()=>{
 const f=browserHarness();await f.context.rigReady;let downloaded,pickers=0;
 f.context.chibiDesktop={setCaptureActive(){}};f.context.showSaveFilePicker=async()=>{pickers++;throw Error('File System Access must not be requested')};
 f.context.downloadBlob=(blob,name)=>downloaded={blob,name};run(f,'trackingState.take={format:"ChibiRigMotion",version:1}');
 await f.context.saveMotionTake();assert.equal(pickers,0);assert.equal(downloaded.name,'take.chibimotion.json');assert.equal(downloaded.blob.type,'application/json');assert.equal(await downloaded.blob.text(),'{"format":"ChibiRigMotion","version":1}\n');
});
test('browser motion saves preserve the file picker and close the selected writable file',async()=>{
 const f=browserHarness();await f.context.rigReady;const written=[];let options,closed=0,downloads=0;
 f.context.showSaveFilePicker=async value=>{options=value;return {createWritable:async()=>({write:async text=>written.push(text),close:async()=>closed++})}};
 f.context.downloadBlob=()=>downloads++;run(f,'trackingState.take={format:"ChibiRigMotion",version:1}');await f.context.saveMotionTake();
 assert.equal(options.suggestedName,'take.chibimotion.json');assert.deepEqual(written,['{"format":"ChibiRigMotion","version":1}\n']);assert.equal(closed,1);assert.equal(downloads,0);
});
