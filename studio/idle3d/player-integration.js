// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
let idle3DPlayer = null;
let idle3DLoading = true;
let idle3DMode = null;

function syncIdle3DControls(mode) {
  if (mode === idle3DMode) return;
  idle3DMode = mode;
  const active = mode === '3d';
  for (const id of ['layerPoseControls','layerSurfaceControls','layerMotionControls']) {
    $(id).disabled = active;
  }
  for (const id of ['layerPoseHint','layerSurfaceHint','layerMotionHint']) $(id).hidden = !active;
  if (active) controls.headEdit.checked = false;
  $('idle3DStatus').textContent = active && idle3DLoading ? '3D待機を読み込み中…' : '';
}

async function initChibiIdle() {
  const control = $('idle3D');
  $('idle3DControl').hidden = false;
  control.dataset.state = 'loading';
  syncIdle3DControls(control.checked ? '3d' : '2d');
  const model = $('idleModel3D');
  try {
    idle3DPlayer = await globalThis.ChibiRigIdle3D.create(model.textContent.trim());
    control.dataset.state = 'ready';
    idle3DMode = null;
  } catch (error) {
    disableChibiIdle(error);
  }
  idle3DLoading = false;
  requestRender();
}

function disableChibiIdle(error) {
  const control = $('idle3D');
  control.checked = false;
  control.disabled = true;
  control.dataset.state = 'unavailable';
  idle3DPlayer = null;
  syncIdle3DControls('2d');
  $('idle3DStatus').textContent = '3D待機を表示できないため、2Dで再生します。';
  console.warn('ChibiRigKit 3D idle unavailable', error);
}

function applyIdle3DCapture(options,t) {
  if (!captureFrame) return;
  // Motion and tracking name the sides of the screen. The GLB names the character's sides.
  if (captureHas('eyeLeft')) options.eyeOpenRight = captureValue('eyeLeft',1,0,1);
  if (captureHas('eyeRight')) options.eyeOpenLeft = captureValue('eyeRight',1,0,1);
  if (captureHas('gazeX')) options.trackedGazeX = captureValue('gazeX');
  if (captureHas('gazeY')) options.trackedGazeY = -captureValue('gazeY');
  if (captureHas('mouthOpen')) options.mouthOpen = captureMouthValue();
  if (captureHas('mouthShape')) options.mouthShape = captureValue('mouthShape');
  const browGain = Number($('captureBrowGain').value) * options.intensity;
  for (const [screen,rig] of [['Left','Right'],['Right','Left']]) {
    const height = 'brow' + screen + 'Y', shape = 'brow' + screen + 'Shape';
    if (captureHas(height,shape)) {
      options['brow' + rig] = captureClamp(captureValue(captureHas(height) ? height : shape) * browGain,-1,1);
    }
  }
  if (captureHas('headYaw','headPitch','headRoll')) {
    const angles = neckSwayAngles(t,options.intensity);
    options.trackedHeadPose = {};
    for (const [channel,axis] of [['headYaw','yaw'],['headPitch','pitch'],['headRoll','roll']]) {
      if (captureHas(channel)) options.trackedHeadPose[axis] = angles[axis];
    }
  }
  if (captureHas('bodyYaw','bodyPitch','bodyRoll')) {
    const gain = Number($('captureBodyGain').value) * options.intensity;
    options.bodyPose = {};
    for (const [channel,axis,sign] of [['bodyYaw','yaw',1],['bodyPitch','pitch',-1],['bodyRoll','roll',1]]) {
      if (captureHas(channel)) options.bodyPose[axis] = sign * captureValue(channel,0,-30,30) * gain;
    }
  }
  if (captureHas('breath')) options.breath = captureClamp(captureValue('breath',0,0,1) * options.intensity,0,1);
}

function drawChibiIdle(t) {
  if (!idle3DPlayer && !idle3DLoading) return false;
  const mode = $('idle3D').checked ? '3d' : '2d';
  syncIdle3DControls(mode);
  if (mode !== '3d') return false;

  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawBackground();
  if (!customBackgroundActive()) {
    for (const id of PROJECT.draw_order) {
      const p = PROJECT.parts[id];
      const artwork = images[p.file];
      if (artwork && isBackgroundPart(p)) ctx.drawImage(artwork,p.x,p.y,p.w,p.h);
    }
  }
  if (idle3DLoading) return true;

  const options = {
    autoBlink: controls.autoBlink.checked,
    autoGaze: controls.headRandom.checked,
    intensity: Number(controls.motionIntensity.value),
    playbackRate: Number(controls.motionSpeed.value),
    gazeAmount: Number(controls.gazeAmount.value),
    gazeX: Number($('gazeX').value),
    gazeY: Number($('gazeY').value),
    headAmount: Number(controls.headAmount.value),
    neckSway: controls.neckSway.checked,
    neckGains: {
      yaw: Number(controls.neckYaw.value) / 12,
      pitch: Number(controls.neckPitch.value) / 8,
      roll: Number(controls.neckAmount.value) / 6
    },
    showMesh: controls.showMesh.checked,
    showHeadMesh: controls.showHeadMesh.checked,
    showPivots: controls.showPivots.checked,
    hairPhysicsAmount: $('hairPhysics').checked ? Number($('hairPhysicsAmount').value) : 0
  };
  if (!controls.headRandom.checked) {
    options.headPose = neckSwayAngles(t,options.intensity,false);
    options.headPoseAt = seconds => neckSwayAngles(seconds / options.playbackRate,options.intensity,false);
    options.headPoseKey = [controls.headCircle.checked,controls.headX.value,controls.headY.value,
      options.neckSway,controls.neckYaw.value,controls.neckPitch.value,controls.neckAmount.value,headRandomSeed].join('/');
  }
  if (controls.manualEyeOpen.checked) options.eyeOpen = Number(controls.eyeOpenTest.value);
  if (controls.manualMouthOpen.checked) options.mouthOpen = Number(controls.mouthOpenTest.value);
  if (controls.autoExpression.checked || Number(controls.expression.value) > 0) options.expression = configuredExpressionValue(t);
  applyIdle3DCapture(options,t);
  try {
    if (!idle3DPlayer.draw(ctx,t * options.playbackRate,options)) {
      $('idle3D').dataset.state = 'waiting';
      $('idle3DStatus').textContent = '3D描画の再開を待っています…';
      frameDirty = true;
    } else if ($('idle3D').dataset.state === 'waiting') {
      $('idle3D').dataset.state = 'ready';
      $('idle3DStatus').textContent = '';
    }
    return true;
  } catch (error) {
    disableChibiIdle(error);
    return false;
  }
}
