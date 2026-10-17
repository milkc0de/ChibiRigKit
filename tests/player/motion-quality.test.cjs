// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const T=require('../../template/workspace/runtime/tracking_core.js');
const {browserHarness}=require('./browser-harness.cjs');
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function result(blend={},m=matrix){return {faceLandmarks:[Array(478)],facialTransformationMatrixes:[{data:m}],faceBlendshapes:[{categories:Object.entries(blend).map(([categoryName,score])=>({categoryName,score}))}]}}

test('adaptive tracking reduces quiet head jitter and follows a deliberate turn faster',()=>{
 let fixed={headYaw:0},adaptive={headYaw:0},fixedPower=0,adaptivePower=0;
 for(let i=0;i<240;i++){
  const next={headYaw:(i%2?1:-1)*.4};
  fixed=T.smooth(fixed,next,1/60,.06);adaptive=T.adaptiveSmooth(adaptive,next,1/60);
  if(i>=120){fixedPower+=fixed.headYaw**2;adaptivePower+=adaptive.headYaw**2}
 }
 assert.ok(adaptivePower<fixedPower*.35,'small alternating camera noise is damped');
 const next={headYaw:20},fast=T.adaptiveSmooth({headYaw:0},next,1/30),old=T.smooth({headYaw:0},next,1/30,.06);
 assert.ok(fast.headYaw>old.headYaw+4);assert.ok(fast.headYaw<20);
 let reference;
 for(const fps of [30,60,120]){
  let frame={headYaw:0};for(let i=0;i<fps;i++)frame=T.adaptiveSmooth(frame,next,1/fps);
  reference??=frame.headYaw;assert.ok(Math.abs(frame.headYaw-reference)<1e-9,'frame rate does not change one-second response');assert.ok(frame.headYaw>19.9);
 }
 assert.equal(T.adaptiveSmooth({headYaw:4},{headYaw:20},0).headYaw,4);
});

test('ordinary full blinks reach the closed art quickly while winks stay independent',()=>{
 const pose=T.solve(result({eyeBlinkLeft:.8,eyeBlinkRight:.03}));assert.equal(pose.eyeLeft,0);assert.equal(pose.eyeRight,1);
 let frame={eyeLeft:1,eyeRight:1};
 for(let i=0;i<2;i++)frame=T.adaptiveSmooth(frame,{eyeLeft:pose.eyeLeft,eyeRight:pose.eyeRight},1/30);
 assert.equal(frame.eyeLeft,0);assert.equal(frame.eyeRight,1);
 frame=T.adaptiveSmooth(frame,{eyeLeft:1,eyeRight:1},1/30);assert.ok(frame.eyeLeft>.7);
 assert.ok(Object.values(T.solve(result({jawOpen:NaN,eyeBlinkLeft:Infinity}))).every(Number.isFinite));
});

test('body follow is calibrated and mirrored with the head, with a slower response',()=>{
 const m=matrix.slice();m[8]=.5;m[10]=Math.sqrt(.75);m[1]=Math.sin(.2);m[0]=Math.cos(.2);
 const normal=T.solve(result({},m),{mirror:false}),mirrored=T.solve(result({},m),{mirror:true});
 assert.equal(normal.bodyYaw,normal.headYaw*.24);assert.equal(normal.bodyRoll,normal.headRoll*.22);assert.equal(normal.bodyPitch,normal.headPitch*.18);
 assert.equal(normal.bodyYaw,-mirrored.bodyYaw);assert.equal(normal.bodyRoll,-mirrored.bodyRoll);
 const center=T.solve(result({},m),{mirror:false,neutral:normal});assert.equal(center.bodyYaw,0);assert.equal(center.bodyRoll,0);
 const extreme=matrix.slice();extreme[1]=1;extreme[0]=0;extreme[8]=1;extreme[10]=0;
 const bounded=T.solve(result({},extreme));assert.equal(Math.abs(bounded.bodyYaw),12);assert.equal(Math.abs(bounded.bodyRoll),6);
 const frame=T.adaptiveSmooth({headYaw:0,bodyYaw:0},{headYaw:20,bodyYaw:4.8},1/30);
 assert.ok(frame.headYaw/20>frame.bodyYaw/4.8,'the body eases behind the head');
});

test('rounded head interpolation preserves all nine poses and convex mesh weights',async()=>{
 const f=browserHarness();await f.context.rigReady;const run=s=>vm.runInContext(s,f.context);
 const directions=run('HEAD_DIRECTIONS');
 for(const [name,[x,y]] of Object.entries(directions)){
  const weights=run(`headWeights(${x},${y})`);assert.equal(weights[name],1);assert.equal(Object.values(weights).reduce((a,b)=>a+b,0),1);
 }
 for(let x=-1;x<=1;x+=.025)for(let y=-1;y<=1;y+=.05){
  const weights=run(`headWeights(${x},${y})`);assert.ok(Object.values(weights).every(w=>w>=0&&w<=1));assert.ok(Math.abs(Object.values(weights).reduce((a,b)=>a+b,0)-1)<1e-12);
 }
 const h=1e-5;assert.ok(Math.abs(run(`headBlendCoordinate(${h})`)/h)<.001);
 assert.ok(Math.abs((1-run(`headBlendCoordinate(${1-h})`))/h)<.001);
 assert.equal(run('headBlendCoordinate(.5)'),.5);
 assert.equal(run(`(()=>{
  const sampler=neckSwayAngles,n=PROJECT.neck_sway;
  try{for(const x of [-1,-.98,-.95,-.05,0,.05,.95,.98,1])for(const y of [-1,-.95,-.05,0,.05,.95,1]){
   neckSwayAngles=()=>({yaw:x*n.yaw_extent,pitch:y*n.pitch_extent,roll:10});neckMasterFrame=null;
   const mesh=neckMasterMesh(0,1);
   for(const [i,j,k] of mesh.triangles){const [a,b,c]=[i,j,k].map(index=>mesh.dest[index]);if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<=0)return false}
  }return true}finally{neckSwayAngles=sampler;neckMasterFrame=null}
 })()`),true,'the authored neck mesh stays unfolded around the rounded joins');
});

test('body amount stops follow, retains breathing, and roundtrips without changing authored poses',async()=>{
 const f=browserHarness();await f.context.rigReady;const run=s=>vm.runInContext(s,f.context);
 const poses=run('JSON.stringify(PROJECT.head_pose)');
 run('captureFrame={bodyYaw:10,bodyPitch:5,bodyRoll:4,breath:.5}');
 const body=run('captureTransform(PROJECT.groups.body_sway,1)'),head=run('captureTransform(PROJECT.groups.head_sway,1)');assert.deepEqual({...body},{...head});assert.equal(body.rot,4);
 f.elements.get('captureBodyGain').value=0;assert.equal(run('captureTransform(PROJECT.groups.body_sway,1).rot'),0);assert.equal(run('captureTransform(PROJECT.groups.body_sway,1).y'),-1.5);
 f.elements.get('captureBodyGain').value=2.3;run('let bodyPreset=collectMotionPreset();applyMotionProject(bodyPreset)');assert.equal(Number(f.elements.get('captureBodyGain').value),2.3);assert.equal(f.elements.get('captureBodyGainOut').textContent,'2.3×');
 assert.equal(run('JSON.stringify(PROJECT.head_pose)'),poses);
 run('bodyPreset.settings.capture_body_gain=3.1');assert.throws(()=>run('applyMotionProject(bodyPreset)'));assert.equal(Number(f.elements.get('captureBodyGain').value),2.3);
 f.elements.get('reset').click();assert.equal(Number(f.elements.get('captureBodyGain').value),1);
});

test('live body follow obeys the head switch and is absent from microphone-only input',async()=>{
 const f=browserHarness();await f.context.rigReady;const run=s=>vm.runInContext(s,f.context);
 run("trackingState.active=true;trackingState.inputMode='camera';trackingState.values=MotionClip.normalize({headYaw:20,bodyYaw:4.8,mouthOpen:.6})");
 assert.equal(run('liveCaptureFrame().bodyYaw'),4.8);
 f.elements.get('trackingHeadOff').checked=true;assert.equal(run('liveCaptureFrame().bodyYaw'),undefined);assert.equal(run('liveCaptureFrame().headYaw'),undefined);assert.equal(run('liveCaptureFrame().mouthOpen'),.6);
 f.elements.get('trackingHeadOff').checked=false;run("trackingState.inputMode='audio'");assert.equal(run('liveCaptureFrame().bodyYaw'),undefined);
});
