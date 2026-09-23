// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
(function(root){
 'use strict';
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),degrees=180/Math.PI;
 function solve(result,{mirror=true,neutral={}}={}){
  if(!result?.faceLandmarks?.length)return null;
  const b=Object.fromEntries((result.faceBlendshapes?.[0]?.categories||[]).map(v=>[v.categoryName,v.score]));
  const score=k=>clamp(b[k]||0,0,1),m=result.facialTransformationMatrixes?.[0]?.data;
  if(!m||m.length!==16||!Array.from(m).every(Number.isFinite))return null;
  const pose={headYaw:Math.atan2(m[8],m[10])*degrees,headPitch:Math.atan2(m[9],Math.hypot(m[8],m[10]))*degrees,headRoll:-Math.atan2(m[1],m[0])*degrees};
  for(const k of Object.keys(pose))pose[k]=clamp(pose[k]-(neutral[k]||0),-90,90);
  // Blendshape Left/Right names are anatomical; the rig uses screen-space names.
  const left=mirror?'Left':'Right',right=mirror?'Right':'Left',sign=mirror?-1:1;
  const brow=side=>clamp(score('browInnerUp')*.45+score('browOuterUp'+side)*.55-score('browDown'+side),-1,1);
  const gaze=(score('eyeLookOutLeft')-score('eyeLookInLeft')+score('eyeLookInRight')-score('eyeLookOutRight'))*.5;
  return {...pose,headYaw:pose.headYaw*sign,headRoll:pose.headRoll*sign,
   eyeLeft:1-score('eyeBlink'+left),eyeRight:1-score('eyeBlink'+right),gazeX:clamp(gaze*sign*2,-1,1),gazeY:clamp((score('eyeLookUpLeft')+score('eyeLookUpRight')-score('eyeLookDownLeft')-score('eyeLookDownRight')),-1,1),
   mouthOpen:clamp(score('jawOpen')*1.8,0,1),mouthShape:clamp((score('mouthSmileLeft')+score('mouthSmileRight')-score('mouthPucker')*2)*.5,-1,1),browLeftY:brow(left),browRightY:brow(right),browLeftShape:score('browOuterUp'+left)-score('browDown'+left),browRightShape:score('browOuterUp'+right)-score('browDown'+right)};
 }
 function smooth(previous,next,dt,seconds=.065){const a=1-Math.exp(-Math.max(0,dt)/seconds);return Object.fromEntries(Object.keys(next).map(k=>[k,(previous?.[k]??next[k])+a*(next[k]-(previous?.[k]??next[k]))]))}
 function audioLevel(samples,{floor=.015,gain=6,previous=0,dt=1/30}={}){let sum=0;for(const x of samples)sum+=x*x;const rms=Math.sqrt(sum/Math.max(1,samples.length)),target=clamp((rms-floor)*gain,0,1),a=1-Math.exp(-dt/(target>previous ? .035 : .10));return {rms,value:previous+(target-previous)*a}}
 const api={solve,smooth,audioLevel};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TrackingCore=api;
})(globalThis);
