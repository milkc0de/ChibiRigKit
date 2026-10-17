// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
(function(root){
 'use strict';
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),degrees=180/Math.PI;
 const ease=(a,b,v)=>{const x=clamp((v-a)/(b-a),0,1);return x*x*(3-2*x)};
 function solve(result,{mirror=true,neutral={}}={}){
  if(!result?.faceLandmarks?.length)return null;
  const b=Object.fromEntries((result.faceBlendshapes?.[0]?.categories||[]).map(v=>[v.categoryName,v.score]));
  const score=k=>Number.isFinite(b[k])?clamp(b[k],0,1):0,m=result.facialTransformationMatrixes?.[0]?.data;
  if(!m||m.length!==16||!Array.from(m).every(Number.isFinite))return null;
  const pose={headYaw:Math.atan2(m[8],m[10])*degrees,headPitch:Math.atan2(m[9],Math.hypot(m[8],m[10]))*degrees,headRoll:-Math.atan2(m[1],m[0])*degrees};
  for(const k of Object.keys(pose))pose[k]=clamp(pose[k]-(Number.isFinite(neutral[k])?neutral[k]:0),-90,90);
  // Blendshape Left/Right names are anatomical; the rig uses screen-space names.
  const left=mirror?'Left':'Right',right=mirror?'Right':'Left',sign=mirror?-1:1;
  const brow=side=>clamp(score('browInnerUp')*.45+score('browOuterUp'+side)*.55-score('browDown'+side),-1,1);
  const gaze=(score('eyeLookOutLeft')-score('eyeLookInLeft')+score('eyeLookInRight')-score('eyeLookOutRight'))*.5;
  return {...pose,headYaw:pose.headYaw*sign,headRoll:pose.headRoll*sign,
   // Body motion is a restrained head-follow estimate, not body tracking.
   bodyYaw:clamp(pose.headYaw*sign*.24,-12,12),bodyPitch:clamp(pose.headPitch*.18,-8,8),bodyRoll:clamp(pose.headRoll*sign*.22,-6,6),
   // MediaPipe blink scores rarely reach 1. Keep open-eye noise quiet and
   // reach the authored closed-eye endpoint during an ordinary full blink.
   eyeLeft:1-ease(.08,.78,score('eyeBlink'+left)),eyeRight:1-ease(.08,.78,score('eyeBlink'+right)),gazeX:clamp(gaze*sign*2,-1,1),gazeY:clamp((score('eyeLookUpLeft')+score('eyeLookUpRight')-score('eyeLookDownLeft')-score('eyeLookDownRight')),-1,1),
   mouthOpen:clamp(score('jawOpen')*1.8,0,1),mouthShape:clamp((score('mouthSmileLeft')+score('mouthSmileRight')-score('mouthPucker')*2)*.5,-1,1),browLeftY:brow(left),browRightY:brow(right),browLeftShape:score('browOuterUp'+left)-score('browDown'+left),browRightShape:score('browOuterUp'+right)-score('browDown'+right)};
 }
 function smooth(previous,next,dt,seconds=.065){const a=1-Math.exp(-Math.max(0,dt)/seconds);return Object.fromEntries(Object.keys(next).map(k=>[k,(previous?.[k]??next[k])+a*(next[k]-(previous?.[k]??next[k]))]))}
 function adaptiveSmooth(previous,next,dt,{seconds=.06}={}){
  const elapsed=Number.isFinite(dt)?clamp(dt,0,.25):0,base=Number.isFinite(seconds)&&seconds>0?seconds:.06;
  // Fixed small integration steps keep the response comparable at 30/60 Hz.
  const steps=Math.max(1,Math.ceil(elapsed*120)),step=elapsed/steps;
  return Object.fromEntries(Object.entries(next).map(([key,target])=>{
   if(!Number.isFinite(target))return [key,Number.isFinite(previous?.[key])?previous[key]:0];
   let value=Number.isFinite(previous?.[key])?previous[key]:target;
   for(let i=0;i<steps;i++){
    const error=Math.abs(target-value);
    let tau=base;
    if(key.startsWith('head'))tau=base*(.35+1.8/(1+(error/3)**2));
    else if(key.startsWith('body'))tau=base*3.5;
    else if(key==='eyeLeft'||key==='eyeRight')tau=target<value ? .008 : .024;
    else if(key==='mouthOpen')tau=target>value ? .022 : .055;
    else if(key.startsWith('gaze'))tau=base*.75;
    value+=(target-value)*(1-Math.exp(-step/tau));
   }
   // Let short blinks reach the actual art swap instead of asymptotically
   // stopping just short of it. All other channels remain continuous.
   if(elapsed>0&&(key==='eyeLeft'||key==='eyeRight')&&Math.abs(target-value)<.012)value=target;
   return [key,value];
  }));
 }
 function audioLevel(samples,{floor=.015,gain=6,previous=0,dt=1/30}={}){let sum=0;for(const x of samples)sum+=x*x;const rms=Math.sqrt(sum/Math.max(1,samples.length)),target=clamp((rms-floor)*gain,0,1),a=1-Math.exp(-dt/(target>previous ? .035 : .10));return {rms,value:previous+(target-previous)*a}}
 const api={solve,smooth,adaptiveSmooth,audioLevel};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TrackingCore=api;
})(globalThis);
