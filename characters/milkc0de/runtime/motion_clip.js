// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
(function(root){
  'use strict';
  const channels={headYaw:[-90,90,0],headPitch:[-90,90,0],headRoll:[-90,90,0],eyeLeft:[0,1,1],eyeRight:[0,1,1],gazeX:[-1,1,0],gazeY:[-1,1,0],mouthOpen:[0,1,0],mouthShape:[-1,1,0],bodyYaw:[-90,90,0],bodyPitch:[-90,90,0],bodyRoll:[-90,90,0],breath:[0,1,0],browLeftX:[-1,1,0],browRightX:[-1,1,0],browLeftY:[-1,1,0],browRightY:[-1,1,0],browLeftAngle:[-1,1,0],browRightAngle:[-1,1,0],browLeftShape:[-1,1,0],browRightShape:[-1,1,0]};
  const finite=v=>typeof v==='number'&&Number.isFinite(v),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function neutral(){return Object.fromEntries(Object.entries(channels).map(([k,v])=>[k,v[2]]))}
  function normalize(frame){return Object.fromEntries(Object.entries(channels).map(([k,[a,b,d]])=>[k,finite(frame?.[k])?clamp(frame[k],a,b):d]))}
  function parse(data){
    const fail=m=>{throw Error('ChibiRig Motion形式エラー：'+m)};
    if(!data||data.format!=='ChibiRigMotion'||data.version!==1||data.timeUnit!=='seconds')fail('ChibiRigMotion version 1 のファイルを選んでください');
    if(!finite(data.duration)||data.duration<=0||data.duration>3600||typeof data.loop!=='boolean')fail('長さまたはループ指定が不正です');
    if(!Array.isArray(data.channels)||!data.channels.length||data.channels.length>Object.keys(channels).length||new Set(data.channels).size!==data.channels.length||data.channels.some(k=>!Object.hasOwn(channels,k)))fail('チャンネル名が不正です');
    if(!Array.isArray(data.frames)||data.frames.length<2||data.frames.length>120001)fail('フレーム数が不正です');
    let previous=-1;
    for(const frame of data.frames){
      if(!Array.isArray(frame)||frame.length!==data.channels.length+1||!frame.every(finite))fail('フレームの値が不正です');
      if(frame[0]<=previous||frame[0]<0||frame[0]>data.duration+1e-6)fail('時刻は重複せず昇順にしてください');previous=frame[0];
      for(let i=0;i<data.channels.length;i++){const [a,b]=channels[data.channels[i]];if(frame[i+1]<a-1e-6||frame[i+1]>b+1e-6)fail(data.channels[i]+'が範囲外です')}
    }
    if(data.frames[0][0]!==0||Math.abs(previous-data.duration)>1e-6)fail('最初は0秒、最後はdurationと一致させてください');
    const frames=data.frames.map(f=>f.slice());
    return {duration:data.duration,loop:data.loop,frames,channels:data.channels.slice(),tracks:data.channels.map((id,i)=>({id,index:i+1,frames}))};
  }
  function interval(frames,time){let a=0,b=frames.length-1;while(a+1<b){const m=(a+b)>>1;if(frames[m][0]<=time)a=m;else b=m}return [frames[a],frames[b]]}
  function evaluate(track,time){const [a,b]=interval(track.frames,time),u=clamp((time-a[0])/(b[0]-a[0]),0,1);return a[track.index]+(b[track.index]-a[track.index])*u}
  function sample(clip,time,loop=clip.loop){
    if(!finite(time))throw Error('再生時刻が不正です');
    const t=loop?((time%clip.duration)+clip.duration)%clip.duration:clamp(time,0,clip.duration),[a,b]=interval(clip.frames,t),u=clamp((t-a[0])/(b[0]-a[0]),0,1),out=neutral();
    clip.channels.forEach((k,i)=>out[k]=a[i+1]+(b[i+1]-a[i+1])*u);return out;
  }
  function create(samples,{loop=false,source='camera',name='Camera take'}={}){
    if(samples.length<2)throw Error('録画が短すぎます');
    const ids=Object.keys(channels),frames=samples.map(s=>{const f=normalize(s.values);return [Math.round(s.time*1e6)/1e6,...ids.map(k=>Math.round(f[k]*1e6)/1e6)]});
    const data={format:'ChibiRigMotion',version:1,timeUnit:'seconds',duration:frames.at(-1)[0],loop,channels:ids,frames,metadata:{name,source,createdAt:new Date().toISOString()}};parse(data);return data;
  }
  const api={channels,neutral,normalize,parse,evaluate,sample,create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MotionClip=api;
})(globalThis);
