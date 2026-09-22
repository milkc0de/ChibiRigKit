// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
let hairFrame=new Map();
function longHairPart(p){return p.role==='hair'&&(p.physics?.type==='long_hair'||p.name.startsWith('hair_back_'))}
function beginHairFrame(t){
  hairFrame.clear();if(controls.headEdit.checked||!$('hairPhysics').checked)return;
  const amount=Number($('hairPhysicsAmount').value)*Math.min(2,Number(controls.motionIntensity.value));if(!amount)return;
  const samples=new Map(),gain=Number(controls.motionIntensity.value);
  const tracks=captureMotion?.clip.tracks.filter(track=>['headYaw','headPitch','headRoll','bodyYaw'].includes(track.id));
  const driver=time=>{
    if(samples.has(time))return samples.get(time);
    const previous=captureFrame;
    try{
      captureFrame=mixedCaptureFrame(time,captureLiveActive()?sampleLiveCapture(time):undefined);
      const a=neckSwayAngles(time,gain),body=captureFrame?captureValue('bodyYaw',0,-30,30)*.7:0;
      const value=a.yaw*1.1+a.roll*2+a.pitch*.15+body;samples.set(time,value);return value;
    }finally{captureFrame=previous}
  };
  for(const p of Object.values(PROJECT.parts))if(longHairPart(p))hairFrame.set(p.name,HairDynamics.response(t,driver,{length:p.h,stiffness:p.physics?.stiffness??(p.name.endsWith('left')?16:12),damping:p.physics?.damping??7})*amount);
}
function hairDeformedPoint(p,source,dest){
  const angle=hairFrame.get(p.name)||0;if(!angle)return dest;
  const s=Math.max(0,Math.min(1,(source[1]-p.y-p.h*.12)/(p.h*.88))),weight=s*s*(3-2*s);
  return [dest[0]+Math.sin(angle)*p.h*weight,dest[1]-(1-Math.cos(angle))*p.h*weight];
}
