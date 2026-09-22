const {ROOT,CHARACTER,RUNTIME,playerHTML}=require('./paths.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {browserHarness}=require('./browser-harness.cjs');
const sample={format:'ChibiRigMotion',version:1,timeUnit:'seconds',duration:2,loop:false,channels:['headYaw','eyeLeft','eyeRight','gazeX','mouthOpen'],frames:[[0,-10,.2,.3,-.2,.4],[2,-10,.2,.3,-.2,.4]]};
async function fixture(){const f=browserHarness();await f.context.rigReady;f.run=s=>vm.runInContext(s,f.context);f.context.sample=sample;return f}
test('only input, camera and microphone selects lock while starting/active; stop and failure unlock',async()=>{
 const f=await fixture(),c=f.context;let finish;const ready=new Promise(r=>finish=r);
 c.navigator.mediaDevices.getUserMedia=()=>ready;c.Worker=class{postMessage(){queueMicrotask(()=>this.onmessage({data:{type:'ready'}}))}terminate(){}};
 const pending=f.run('startTracking()');for(const id of ['trackingInput','cameraDevice','microphoneDevice'])assert.equal(f.elements.get(id).disabled,true);
 assert.equal(f.elements.get('backgroundMode').disabled,false);assert.equal(f.elements.get('trackingHeadOff').disabled,false);
 const track={stop(){},kind:'video'};finish({getTracks:()=>[track],getVideoTracks:()=>[track]});await pending;
 for(const id of ['trackingInput','cameraDevice','microphoneDevice'])assert.equal(f.elements.get(id).disabled,true);
 f.run('stopTracking()');for(const id of ['trackingInput','cameraDevice','microphoneDevice'])assert.equal(f.elements.get(id).disabled,false);
 c.navigator.mediaDevices.getUserMedia=async()=>{throw Error('denied')};await f.run('startTracking()');for(const id of ['trackingInput','cameraDevice','microphoneDevice'])assert.equal(f.elements.get(id).disabled,false);
});
test('camera keeps all three switches usable; microphone mouth cannot be disabled',async()=>{
 const f=await fixture();for(const mode of ['camera','both']){f.elements.get('trackingInput').value=mode;f.run('trackingUI()');for(const id of ['trackingEyesOff','trackingMouthOff','trackingHeadOff'])assert.equal(f.elements.get(id).disabled,false)}
 f.elements.get('trackingMouthOff').checked=true;f.elements.get('trackingInput').value='audio';f.run("trackingUI();trackingState.active=true;trackingState.inputMode='audio';trackingState.values=MotionClip.normalize({mouthOpen:.8,headYaw:20,eyeLeft:0})");
 assert.equal(f.elements.get('trackingMouthOff').disabled,true);assert.equal(f.elements.get('trackingMouthOff').checked,false);const values=f.run('liveCaptureFrame()');assert.equal(values.mouthOpen,.8);assert.equal(values.headYaw,undefined);assert.equal(values.eyeLeft,undefined);
});
test('per-region priority is live input, playing file, ordinary motion; pause and EOF release fallback',async()=>{
 const f=await fixture();f.run("loadCaptureMotion(sample,'clip');trackingState.active=true;trackingState.inputMode='camera';trackingState.values=MotionClip.normalize({headYaw:20,eyeLeft:.9,eyeRight:.8,gazeX:.6,mouthOpen:.7});controls.headRandom.checked=false;controls.neckSway.checked=false;controls.headX.value=.2;controls.headY.value=0;controls.manualMouthOpen.checked=true;controls.mouthOpenTest.value=.25;");
 f.run('beginCaptureFrame(0)');assert.equal(f.run('captureFrame.headYaw'),20);
 for(const id of ['trackingEyesOff','trackingMouthOff','trackingHeadOff'])f.elements.get(id).checked=true;
 f.run('beginCaptureFrame(0)');assert.equal(f.run('captureHas("headYaw","eyeLeft","mouthOpen")'),false);assert.equal(f.run('mouthOpenValue()'),.25);assert.equal(f.run('captureEyeOpen(PROJECT.parts.eye_left_sclera,.6)'),.6);assert.equal(f.run('neckSwayAngles(0,1).yaw'),5);
 f.run('setCapturePlayback(true);beginCaptureFrame(.5)');assert.equal(f.run('captureFrame.headYaw'),-10);assert.equal(f.run('captureFrame.eyeLeft'),.2);assert.equal(f.run('captureFrame.mouthOpen'),.4);
 f.elements.get('trackingEyesOff').checked=false;f.run('beginCaptureFrame(.5)');assert.equal(f.run('captureFrame.eyeLeft'),.9);assert.equal(f.run('captureFrame.headYaw'),-10);
 f.run('setCapturePlayback(false);beginCaptureFrame(.5)');assert.equal(f.run('captureHas("headYaw","mouthOpen")'),false);assert.equal(f.run('mouthOpenValue()'),.25);
 f.run('seekCaptureMotion(0);setCapturePlayback(true);beginCaptureFrame(3)');assert.equal(f.run('capturePlaying'),false);assert.equal(f.run('captureHas("headYaw","mouthOpen")'),false);
});
test('starting capture retains a loaded playing motion; loading a replacement keeps camera on',async()=>{
 const f=await fixture(),c=f.context;f.run("loadCaptureMotion(sample,'clip');setCapturePlayback(true)");
 const track={stop(){},kind:'video'};c.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]});c.Worker=class{postMessage(){queueMicrotask(()=>this.onmessage({data:{type:'ready'}}))}terminate(){}};
 await f.run('startTracking()');assert.equal(f.run('captureMotion.name'),'clip');assert.equal(f.run('capturePlaying'),true);
 f.run("loadCaptureMotion(sample,'replacement')");assert.equal(f.run('trackingState.active'),true);assert.equal(f.run('captureMotion.name'),'replacement');assert.equal(f.run('capturePlaying'),false);
});
test('standalone motion seeking and speed changes keep the chosen frame position',async()=>{
 const f=await fixture();f.run("loadCaptureMotion(sample,'clip');seekCaptureMotion(.8)");assert.equal(f.run('capturePosition(42)'),.8);f.run('setCapturePlayback(true)');assert.equal(f.run('capturePosition(.5)'),1.3);
 f.context.performance.now=()=>1500;f.run('setCapturePlayback(false)');assert.equal(f.run('capturePosition(42)'),1.3);f.run('seekCaptureMotion(.2);setCapturePlayback(true)');assert.ok(Math.abs(f.run('capturePosition(.5)')-.2)<1e-8);
});

test('input stop stays usable during live WebM recording and releases both streams without saving',async()=>{
 const f=await fixture(),c=f.context;let inputStops=0,outputStops=0,downloads=0;
 const track={stop(){inputStops++},kind:'video'};
 c.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]});
 c.Worker=class{postMessage(){queueMicrotask(()=>this.onmessage({data:{type:'ready'}}))}terminate(){}};
 c.MediaRecorder=class{static isTypeSupported(){return true}constructor(){this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['video'])});this.onstop()}};
 c.outputStream={getTracks:()=>[{stop(){outputStops++}}]};c.auditDownload=()=>downloads++;
 f.run('outputCanvas.captureStream=()=>outputStream;downloadBlob=auditDownload');
 await f.run('startTracking()');
 const done=f.run('recordLoop()');
 assert.equal(f.elements.get('cameraStop').disabled,false);assert.equal(f.elements.get('trackingInput').disabled,true);
 f.elements.get('cameraStop').click();await done;
 assert.equal(inputStops,1);assert.equal(outputStops,1);assert.equal(downloads,0);assert.equal(f.run('trackingState.active'),false);
 assert.equal(f.elements.get('cameraStop').disabled,true);assert.equal(f.elements.get('trackingInput').disabled,false);
});
