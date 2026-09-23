// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
window.runMotionIOChecks=()=>{
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const original=collectMotionProject(),selection=$('partSelect').value;
  const fingerprint=()=>{running=false;render(.37);return canvas.toDataURL()};
  try{
    const owner=transformOwner(Object.values(PROJECT.parts).find(p=>p.kind!=='static'));
    owner.motion.rot_deg=2.75;owner.motion.x_px=3.5;
    const group=Object.values(PROJECT.groups||{})[0];if(group)group.motion.rot_deg=.7;
    controls.duration.value=7.5;controls.motionIntensity.value=1.65;controls.motionSpeed.value=1.3;
    controls.autoBlink.checked=false;controls.autoExpression.checked=false;controls.expression.value=.3;
    controls.manualEyeOpen.checked=true;controls.eyeOpenTest.value=.6;controls.manualMouthOpen.checked=true;controls.mouthOpenTest.value=.4;
    controls.headRandom.checked=false;controls.headCircle.checked=false;controls.headX.value=.4;controls.headY.value=-.3;$('gazeX').value=.2;
    const saved=JSON.parse(JSON.stringify(collectMotionProject()));
    const compact=JSON.parse(JSON.stringify(collectMotionPreset()));
    assert(!JSON.stringify(compact).includes('data:image/'),'Motion preset includes image bytes');
    const expected=fingerprint();
    $('reset').click();applyMotionProject(saved);
    assert(fingerprint()===expected,'Full motion JSON changed the rendered frame');
    $('reset').click();applyMotionProject(compact);assert(fingerprint()===expected,'Compact motion JSON changed the rendered frame');
    const poses=JSON.stringify(PROJECT.head_pose);delete compact.head_pose;applyMotionProject(compact);assert(JSON.stringify(PROJECT.head_pose)===poses,'Motion-only preset changed head poses');
    assert(Number(controls.motionSpeed.value)===1.3&&Number(controls.motionIntensity.value)===1.65,'Global motion settings were not restored');
    assert(PROJECT.parts[owner.name].motion.rot_deg===2.75,'Per-part rotation was not restored');
    if(group)assert(Object.values(PROJECT.groups)[0].motion.rot_deg===.7,'Group motion was not restored');
    const stable=JSON.stringify(collectMotionProject()),before=fingerprint();
    for(const mutate of [x=>x.canvas.width++,x=>x.settings.motion_speed=0,x=>x.parts[owner.name].motion.rot_deg=NaN,x=>delete x.parts[owner.name]]){
      const invalid=structuredClone(saved);mutate(invalid);let rejected=false;
      try{applyMotionProject(invalid)}catch{rejected=true}
      assert(rejected,'Invalid motion JSON was accepted');
      assert(JSON.stringify(collectMotionProject())===stable&&fingerprint()===before,'Rejected import changed live state');
    }
    const legacy=structuredClone(saved);delete legacy.settings.motion_speed;delete legacy.settings.manual_eye_open;
    applyMotionProject(legacy);assert(Number(controls.motionSpeed.value)===1&&!controls.manualEyeOpen.checked,'Legacy JSON defaults were not restored');
    $('reset').click();assert(JSON.stringify(PROJECT.groups)===JSON.stringify(initialGroups),'Reset left imported group motion');
    return {compactPreset:true,templatePreservesHead:true,roundtrip:true,pixelIdentical:true,globalSettings:true,groupMotion:!!group,legacyJSON:true,rejectedImports:4,atomic:true};
  }finally{applyMotionProject(original);$('partSelect').value=selection;syncSelected();running=false}
};
