// SPDX-License-Identifier: MIT
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {browserHarness}=require('./browser-harness.cjs');
const run=(f,code)=>vm.runInContext(code,f.context);
function camera(f){let stopped=0;const track={stop(){stopped++}},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};f.context.navigator.mediaDevices.getUserMedia=async()=>stream;f.context.Worker=class{postMessage(){queueMicrotask(()=>this.onmessage({data:{type:'ready'}}))}terminate(){}};return ()=>stopped}
test('microphone uses unprocessed selected input, preserves stereo phase and never monitors to speakers',async()=>{
 const f=browserHarness();await f.context.rigReady;const order=[],nodes=[];let constraints,closed=0;
 f.elements.get('trackingInput').value='audio';f.elements.get('microphoneDevice').value='virtual-cable';
 f.context.fetch=()=>{throw Error('Audio-only must not download camera assets')};
 f.context.AudioContext=class{
  constructor(){order.push('context');this.state='running';this.destination={}}
  async resume(){order.push('resume')}
  createMediaStreamSource(){return {connect(){}}}
  createChannelSplitter(){return {connect(analyser,channel){analyser.channel=channel}}}
  createAnalyser(){const a={channel:0,connect(){},getFloatTimeDomainData(buffer){buffer.fill(this.channel===0?.2:-.2)}};nodes.push(a);return a}
  createGain(){return {gain:{value:1},connect(){}}}
  async close(){closed++}
 };
 f.context.navigator.mediaDevices.getUserMedia=async value=>{order.push('getUserMedia');constraints=value;return {getTracks:()=>[{stop(){}}],getVideoTracks:()=>[],getAudioTracks:()=>[{getSettings:()=>({channelCount:2})}]}};
 await f.context.startTracking();assert.deepEqual(order,['context','resume','getUserMedia']);assert.equal(constraints.audio.deviceId.exact,'virtual-cable');assert.equal(constraints.audio.echoCancellation,false);assert.equal(constraints.audio.noiseSuppression,false);assert.equal(constraints.audio.autoGainControl,false);
 f.context.trackingTick(1100);assert.ok(f.elements.get('audioMeter').value>.19);assert.ok(run(f,'trackingState.values.mouthOpen')>0);assert.equal(run(f,'trackingState.audio.silent.gain.value'),0);assert.ok(run(f,'trackingState.audio.source'));assert.equal(nodes.length,2);
 f.context.stopTracking();assert.equal(closed,1);assert.equal(f.elements.get('audioMeter').value,0);
});
test('missing tracking assets are prepared on tracking start before requesting the camera',async()=>{
 const f=browserHarness();await f.context.rigReady;const stopped=camera(f),requests=[];
 f.context.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url==='/api/tracking'?{camera:false,setupToken:'token'}:{camera:true}}};
 await f.context.startTracking();assert.deepEqual(requests.map(x=>x.url),['/api/tracking','/api/tracking/setup']);assert.equal(requests[1].options.headers['X-ChibiRig-Token'],'token');assert.equal(run(f,'trackingState.active'),true);f.context.stopTracking();assert.equal(stopped(),1);
});
test('download failure reports preparation error without opening devices',async()=>{
 const f=browserHarness();await f.context.rigReady;let devices=0;f.context.navigator.mediaDevices.getUserMedia=()=>{devices++;throw Error('unexpected')};
 f.context.fetch=async url=>({ok:url==='/api/tracking',json:async()=>url==='/api/tracking'?{camera:false,setupToken:'token'}:{error:'download failed'}});
 await f.context.startTracking();assert.equal(devices,0);assert.match(f.elements.get('trackingStatus').textContent,/download failed/);assert.equal(run(f,'trackingState.starting'),false);
});
test('cancelling asset preparation does not start the camera when the download finishes',async()=>{
 const f=browserHarness();await f.context.rigReady;let finish,prepared,devices=0;const reached=new Promise(resolve=>prepared=resolve);
 f.context.navigator.mediaDevices.getUserMedia=()=>{devices++;throw Error('unexpected')};
 f.context.fetch=async url=>{if(url==='/api/tracking')return {ok:true,json:async()=>({camera:false,setupToken:'token'})};prepared();await new Promise(resolve=>finish=resolve);return {ok:true,json:async()=>({camera:true})}};
 const pending=f.context.startTracking();await reached;f.context.stopTracking();finish();await pending;assert.equal(devices,0);assert.equal(run(f,'trackingState.active||trackingState.starting'),false);
});
