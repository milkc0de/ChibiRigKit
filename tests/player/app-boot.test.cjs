const {ROOT,CHARACTER,RUNTIME,playerHTML}=require('./paths.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {browserHarness}=require('./browser-harness.cjs');
test('parent player boots with browser rendering and no removed controls',async()=>{
 const {context:c,elements,contexts}=browserHarness();await c.rigReady;assert.equal(elements.get('loadStatus').textContent,'読み込み完了');
 for(const id of ['pauseWebPreview','desktopOutput','outputStop','playerImport','playerImportFile','takeWrite'])assert.equal(elements.get(id),undefined);
 assert.equal(elements.get('captureYawGain').value,'1');vm.runInContext('render(0)',c);const display=contexts.find(x=>x.id==='c'),count=display.draws;assert.ok(count>0);vm.runInContext('renderOutput()',c);assert.equal(display.draws,count+1);
});
test('dragging can move and resize output region without changing aspect of source pixels',async()=>{const {context:c}=browserHarness();await c.rigReady;const value=vm.runInContext("cropFromDrag({mode:'move',start:[50,50],rect:{x:0,y:0,w:100,h:200}},[2000,-100])",c);assert.equal(value.x,1052);assert.equal(value.y,0);assert.throws(()=>vm.runInContext('validOutputCrop({x:0,y:0,w:0,h:0})',c));const shape=vm.runInContext("cropFromDrag({mode:'new',start:[200,300]},[50,100])",c);assert.equal(shape.x,50);assert.equal(shape.h,200)});
test('camera and audio start only on request, motion take replays, and stop releases devices',async()=>{
 const {context:c,elements}=browserHarness();await c.rigReady;let requests=0,stopped=0,terminated=0,closed=0;
 const videoTrack={kind:'video',stop(){stopped++}},audioTrack={kind:'audio',stop(){stopped++}},stream={getTracks:()=>[videoTrack,audioTrack],getVideoTracks:()=>[videoTrack]};
 c.navigator.mediaDevices.getUserMedia=async()=>{requests++;return stream};
 c.Worker=class{postMessage(data){if(data.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}))}terminate(){terminated++}};
 c.AudioContext=class{async resume(){}createAnalyser(){return {fftSize:1024,getFloatTimeDomainData:a=>a.fill(.2)}}createMediaStreamSource(){return {connect(){}}}async close(){closed++}};
 elements.get('trackingInput').value='both';assert.equal(requests,0);await vm.runInContext('startTracking()',c);assert.equal(requests,1);assert.equal(vm.runInContext('trackingState.active',c),true);
 vm.runInContext('trackingTick(1100);startMotionTake();trackingTick(1200);trackingTick(1300)',c);c.performance.now=()=>1500;vm.runInContext('stopMotionTake()',c);
 const take=vm.runInContext('trackingState.take',c);assert.equal(take.format,'ChibiRigMotion');assert.ok(take.frames.length>=3);assert.ok(take.frames.at(-1)[take.channels.indexOf('mouthOpen')+1]>0);
 vm.runInContext("loadCaptureMotion(trackingState.take,'test take')",c);assert.equal(vm.runInContext('trackingState.active',c),true);vm.runInContext('stopTracking()',c);assert.equal(stopped,2);assert.equal(terminated,1);assert.equal(closed,1);assert.equal(vm.runInContext('captureMotion.clip.duration',c),.5);
 vm.runInContext('seekCaptureMotion(.25);beginCaptureFrame(.25)',c);assert.ok(vm.runInContext('captureFrame.mouthOpen',c)>0);
});
test('permission denial and cancellation do not leave media active',async()=>{
 const {context:c,elements}=browserHarness();await c.rigReady;c.navigator.mediaDevices.getUserMedia=async()=>{throw Error('NotAllowedError')};await vm.runInContext('startTracking()',c);assert.equal(vm.runInContext('trackingState.active',c),false);assert.equal(elements.get('cameraStart').disabled,false);
 let finish,stopped=0;c.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>finish=resolve);const pending=vm.runInContext('startTracking()',c);vm.runInContext('stopTracking()',c);finish({getTracks:()=>[{stop(){stopped++}}]});await pending;assert.equal(stopped,1);assert.equal(vm.runInContext('trackingState.active',c),false);
});

test('specified parent character boots with its saved settings',async()=>{
 const project=structuredClone(require('../../characters/milkc0de/rig.project.json'));project.name='Character <test>';project.settings.capture_yaw_gain=.75;
 const html=playerHTML(project),{context:c,elements}=browserHarness(html);await c.rigReady;
 assert.equal(elements.get('loadStatus').textContent,'読み込み完了');assert.equal(elements.get('captureYawGain').value,.75);
 assert.match(html,/<title>Character &lt;test&gt; - ChibiRigKit<\/title>/);assert.ok(!html.includes('__PROJECT_JSON__'));
});
test('cancelling during worker initialization releases the pending startup immediately',async()=>{
 const {context:c,elements}=browserHarness();await c.rigReady;let stopped=0,initialized;
 const init=new Promise(resolve=>initialized=resolve),track={kind:'video',stop(){stopped++}};
 c.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]});
 c.Worker=class{postMessage(){initialized()}terminate(){}};
 const pending=vm.runInContext('startTracking()',c);await init;vm.runInContext('stopTracking()',c);await pending;
 assert.equal(vm.runInContext('trackingState.active||trackingState.starting',c),false);assert.equal(elements.get('cameraStart').disabled,false);assert.ok(stopped>=1);
});
