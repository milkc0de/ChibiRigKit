// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {browserHarness} = require('./browser-harness.cjs');

test('settings resolve on the selected 3D rig, including while paused',async()=>{
  const {context,elements} = browserHarness();
  await context.rigReady;
  const frames = [];
  let finishLoading, canDraw=true;
  context.ChibiRigIdle3D = {create:()=>new Promise(resolve=>{finishLoading=()=>resolve({
    draw(ctx,time,options){frames.push({time,options});return canDraw;}
  });})};
  const adapter = fs.readFileSync(path.resolve(__dirname,'../../studio/idle3d/player-integration.js'),'utf8');
  vm.runInContext(adapter,context);
  const get = id=>elements.get(id);
  const run = code=>vm.runInContext(code,context);
  const frame = t=>{run('render('+t+')');assert.equal(get('c').dataset.renderMode,'3d');return frames.at(-1).options;};
  const dispatch = (id,event)=>{const el=get(id);for(const listener of el.listeners[event]||[])listener({target:el});};
  const loading = run('initChibiIdle()');
  get('idle3D').checked = true;
  run('render(0)');
  assert.equal(get('c').dataset.renderMode,'loading');
  assert.equal(frames.length,0);
  finishLoading();
  await loading;
  run('running=false;pausedAt=2');
  get('headRandom').checked = true;
  get('gazeX').value = -.45;
  get('gazeY').value = .30;
  get('motionSpeed').value = 1.5;
  get('motionIntensity').value = 0;
  const native=frame(2);
  assert.equal(frames.at(-1).time,3);
  assert.equal(native.intensity,0);
  assert.equal(native.gazeX,-.45);
  assert.equal(native.gazeY,.30);
  assert.equal(native.autoGaze,true);
  assert.equal(native.headPose,undefined);
  assert.equal(native.eyeOpen,undefined);

  get('neckYaw').value=18;get('neckPitch').value=4;get('neckAmount').value=0;
  for(const id of ['showMesh','showHeadMesh','showPivots','autoExpression'])get(id).checked=true;
  get('eyeOpenTest').value=.25;dispatch('eyeOpenTest','input');
  get('mouthOpenTest').value=.8;dispatch('mouthOpenTest','input');
  const face=frame(3);
  assert.deepEqual({...face.neckGains},{yaw:1.5,pitch:.5,roll:0});
  assert.equal(face.eyeOpen,.25);assert.equal(face.mouthOpen,.8);assert.equal(face.expression,1);
  for(const id of ['showMesh','showHeadMesh','showPivots'])assert.equal(face[id],true);
  get('expression').value=.4;dispatch('expression','input');
  assert.equal(frame(3).expression,.4);

  get('headRandom').checked=false;dispatch('headRandom','change');
  get('neckSway').checked=false;get('headX').value=-1;get('headY').value=.5;dispatch('headX','input');
  const manual=frame(2);
  assert.equal(get('idle3D').checked,true);
  assert.equal(manual.headPose.yaw,-25);assert.equal(manual.headPose.pitch,12.5);
  assert.equal(manual.autoGaze,false);
  assert.deepEqual({...manual.headPoseAt(3)},{...manual.headPose});
  get('headCircle').checked=true;dispatch('headCircle','change');
  assert.notEqual(frame(0).headPose.pitch,frame(1).headPose.pitch);

  for(const id of ['layerPoseControls','layerSurfaceControls','layerMotionControls'])assert.equal(get(id).disabled,true);
  get('showBaseOnly').checked=true;get('showSeams').checked=false;
  frame(1);
  get('idle3D').checked=false;run('render(1)');
  assert.equal(get('c').dataset.renderMode,'2d');
  assert.equal(get('layerMotionControls').disabled,false);
  get('reset').click();assert.equal(get('idle3D').checked,false);
  get('idle3D').checked=true;frame(1);
  assert.equal(get('layerMotionControls').disabled,true);
  canDraw=false;run('render(2)');
  assert.equal(get('idle3D').checked,true);assert.equal(get('c').dataset.renderMode,'loading');
  assert.match(get('idle3DStatus').textContent,/再開/);
  canDraw=true;frame(2);assert.equal(get('idle3DStatus').textContent,'');
});

test('3D tracking uses only supplied channels across microphone, camera, file and OBS input',async()=>{
  const {context,elements} = browserHarness();
  await context.rigReady;
  let options;
  context.ChibiRigIdle3D = {create:async()=>({draw(ctx,time,frame){options=frame;return true;}})};
  const run = code=>vm.runInContext(code,context);
  run(fs.readFileSync(path.resolve(__dirname,'../../studio/idle3d/player-integration.js'),'utf8'));
  await run('initChibiIdle()');
  const get = id=>elements.get(id);
  const draw = () => {
    run('render(0.5)');
    assert.equal(get('c').dataset.renderMode,'3d');
    return options;
  };
  get('idle3D').checked=true;
  get('headRandom').checked=true;
  get('motionIntensity').value=1;
  get('captureMouthGain').value=2;
  get('expression').value=.35;
  run("trackingState.active=true;trackingState.inputMode='audio';trackingState.values=MotionClip.normalize({mouthOpen:.4})");
  const mic=draw();
  assert.equal(mic.mouthOpen,.8);assert.equal(mic.expression,.35);
  for(const key of ['mouthShape','trackedHeadPose','eyeOpenRight','trackedGazeX','bodyPose'])assert.equal(mic[key],undefined);

  run("trackingState.inputMode='both';trackingState.values=MotionClip.normalize({headYaw:16,headPitch:7,headRoll:-3,eyeLeft:0,eyeRight:.9,gazeX:0,gazeY:.6,browLeftY:.4,browRightY:-.1,mouthOpen:.3,mouthShape:-.4,bodyYaw:3,bodyPitch:1,bodyRoll:-2})");
  for(const axis of ['Yaw','Pitch','Roll'])get('capture'+axis+'Gain').value=1;
  get('captureBodyGain').value=.5;get('captureBrowGain').value=2;
  const camera=draw();
  assert.deepEqual({...camera.trackedHeadPose},{yaw:16,pitch:-7,roll:-3});
  assert.equal(camera.eyeOpenRight,0);assert.equal(camera.eyeOpenLeft,.9);
  assert.equal(camera.trackedGazeX,0);assert.equal(camera.trackedGazeY,-.6);
  assert.equal(camera.browRight,.8);assert.equal(camera.browLeft,-.2);
  assert.equal(camera.mouthOpen,.6);assert.equal(camera.mouthShape,-.4);
  assert.deepEqual({...camera.bodyPose},{yaw:1.5,pitch:-.5,roll:-1});

  context.clip={format:'ChibiRigMotion',version:1,timeUnit:'seconds',duration:2,loop:true,
    channels:['headYaw','eyeLeft','gazeX','mouthShape','breath'],frames:[[0,-8,.2,.75,.45,.5],[2,-8,.2,.75,.45,.5]]};
  run("loadCaptureMotion(clip,'face');setCapturePlayback(true);trackingState.inputMode='audio'");
  const mixed=draw();
  assert.equal(mixed.mouthOpen,.6);assert.equal(mixed.mouthShape,.45);assert.equal(mixed.eyeOpenRight,.2);
  assert.equal(mixed.eyeOpenLeft,undefined);assert.equal(mixed.trackedGazeY,undefined);
  assert.deepEqual({...mixed.trackedHeadPose},{yaw:-8});assert.equal(mixed.breath,.5);
  get('headRandom').checked=false;get('neckSway').checked=false;get('headY').value=.4;
  const manual=draw();
  assert.equal(manual.headPose.pitch,10);assert.equal(manual.headPoseAt(12).pitch,10);

  run("trackingState.active=false;clearCaptureMotion();playerSync.role='view';receivePlayerSyncLive({active:true,values:{eyeRight:0,headRoll:4,mouthOpen:0}})");
  const obs=draw();
  assert.equal(obs.eyeOpenLeft,0);assert.equal(obs.eyeOpenRight,undefined);assert.equal(obs.mouthOpen,0);
  assert.deepEqual({...obs.trackedHeadPose},{roll:4});
  get('idle3D').checked=false;run('render(.5)');assert.equal(get('c').dataset.renderMode,'2d');
  get('idle3D').checked=true;run('receivePlayerSyncLive({active:false,values:{}})');
  assert.equal(draw().trackedHeadPose,undefined);assert.equal(options.mouthOpen,undefined);
});
