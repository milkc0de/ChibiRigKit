// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
window.runHeadChecks=()=>{
  if(!PROJECT.head_pose)return {enabled:false};
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const original=structuredClone(PROJECT.head_pose),draft=structuredClone(headDraft),direction=headDirection;
  const oldStorage=localStorage.getItem(headKey),selectedPart=$('headPart').value;
  const sheet=document.createElement('canvas');sheet.width=900;sheet.height=1020;
  const g=sheet.getContext('2d');g.fillStyle='#292b32';g.fillRect(0,0,900,1020);
  const irisParts=Object.values(PROJECT.parts).filter(p=>p.kind==='eye_iris');
  let clipChecks=0,renderCount=0,changed=0;
  const startCheck=performance.now();
  try{
    controls.headRandom.checked=false;controls.headEdit.checked=false;controls.headCircle.checked=false;controls.motionIntensity.value=0;
    controls.autoBlink.checked=false;controls.autoExpression.checked=false;controls.expression.value=0;
    controls.manualEyeOpen.checked=true;controls.manualMouthOpen.checked=true;controls.mouthOpenTest.value=1;
    for(const [name,[x,y]] of Object.entries(HEAD_DIRECTIONS)){
      const w=headWeights(x,y);assert(w[name]===1&&Object.values(w).reduce((a,b)=>a+b,0)===1,'Direction endpoint does not reproduce saved pose');
    }
    const reference=PROJECT.parts[PROJECT.head_pose.part_ids[0]];
    const a=mixedHeadSetting(reference,-1e-7,.5),b=mixedHeadSetting(reference,1e-7,.5);
    assert(Math.abs(a.x-b.x)<.001&&Math.abs(a.scale_x-b.scale_x)<.001,'Pose discontinuity at grid boundary');
    const fingerprints=[];
    let n=0;
    for(const [name,[x,y]] of Object.entries(HEAD_DIRECTIONS)){
      controls.headX.value=x;controls.headY.value=y;$('gazeX').value=x;$('gazeY').value=y;
      for(const eye of [1,.5,0]){
        controls.eyeOpenTest.value=eye;render(.37);renderCount++;
        for(const p of irisParts){
          const iris=renderHeadSurface(p,.37,0,eye).getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
          const white=renderHeadSurface(PROJECT.parts[p.clip_to],.37,0,eye).getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
          for(let i=3;i<iris.length;i+=4)assert(!iris[i]||white[i]>0,'Pupil escaped sclera at '+name);
          if(eye===0)assert(partOpacity(p,0,eye)===0,'Pupil visible at full blink');clipChecks++;
        }
      }
      controls.eyeOpenTest.value=1;render(.37);
      fingerprints.push(canvas.toDataURL());
      const ratio=Math.min(280/canvas.width,295/canvas.height),w=canvas.width*ratio,h=canvas.height*ratio;
      g.drawImage(canvas,n%3*300+(300-w)/2,Math.floor(n/3)*340,w,h);
      g.fillStyle='#fff';g.font='16px system-ui';g.fillText(HEAD_LABELS[name],n%3*300+20,Math.floor(n/3)*340+323);n++;
    }
    changed=new Set(fingerprints).size;
    const animated=Object.values(original.poses).some(p=>Object.values(p.parts).some(s=>(s.x||s.y||s.rotation)||s.vertices?.some(v=>v[0]||v[1])));
    if(animated)assert(changed>1,'Authored head directions did not change rendered pixels');
    for(let i=0;i<32;i++){
      controls.headX.value=Math.sin(i*Math.PI/16);controls.headY.value=-Math.cos(i*Math.PI/16);
      for(const pid of original.part_ids)assert(validHeadMesh(PROJECT.parts[pid],mixedHeadSetting(PROJECT.parts[pid],Number(controls.headX.value),Number(controls.headY.value))),'Mesh folded while circling');
      render(.37);renderCount++;
    }
    const seed=12345,randomSamples=[];
    for(let i=0;i<240;i++){
      const t=i*.1,value=randomHeadAngle(t,seed);randomSamples.push(value);
      assert(value.every(v=>Number.isFinite(v)&&Math.abs(v)<=1),'Random head escaped pose range');
      assert(JSON.stringify(value)===JSON.stringify(randomHeadAngle(t,seed)),'Random head depends on frame history');
      if(i)assert(Math.hypot(value[0]-randomSamples[i-1][0],value[1]-randomSamples[i-1][1])<.15,'Random head jumped');
    }
    assert(new Set(randomSamples.map(v=>JSON.stringify(v))).size>20,'Random head is static');
    assert(JSON.stringify(randomHeadAngle(7,seed))!==JSON.stringify(randomHeadAngle(7,67890)),'Random seeds have no effect');
    controls.headRandom.checked=true;controls.motionIntensity.value=1;resetRandomHead();
    for(let i=0;i<24;i++){render(i*.3);renderCount++;for(const pid of original.part_ids)assert(validHeadMesh(PROJECT.parts[pid],mixedHeadSetting(PROJECT.parts[pid],...headAngle)),'Random+sway folded mesh')}
    const swayPart=Object.values(PROJECT.parts).find(p=>['rot_deg','x_px','y_px','scale_x_pct','scale_y_pct'].some(k=>p.motion?.[k]));
    if(swayPart)assert(JSON.stringify(partMatrix(swayPart,.2,1))!==JSON.stringify(partMatrix(swayPart,1.1,1)),'Existing sway stopped');
    controls.headRandom.checked=false;
    selectHeadDirection('left');$('headPart').value=original.part_ids[0];controls.headEdit.checked=true;
    const pid=$('headPart').value,before=headSetting(PROJECT.parts[pid],headDraft).x;
    editHeadSetting(s=>s.x+=3);saveHeadPoses();
    const restored=JSON.parse(localStorage.getItem(headKey));validateHeadConfig(restored);
    assert(restored.poses.left.parts[pid].x===before+3,'Edited pose did not persist');
    const bad=structuredClone(restored);bad.layout_signature='wrong-layout';let rejected=false;
    try{validateHeadConfig(bad)}catch{rejected=true}assert(rejected,'Wrong-character poses accepted');
    return {enabled:true,directions:9,distinctRenders:changed,circleFrames:32,randomSamples:240,randomSwayFrames:24,renderCount,pupilClipChecks:clipChecks,storageRoundtrip:true,wrongLayoutRejected:true,elapsedMs:Math.round(performance.now()-startCheck),png:sheet.toDataURL().split(',')[1]};
  }finally{
    PROJECT.head_pose=original;headDraft=draft;headDirection=direction;$('headPart').value=selectedPart;
    if(oldStorage===null)localStorage.removeItem(headKey);else localStorage.setItem(headKey,oldStorage);
    $('reset').click();running=false;syncHeadEditor();
  }
};
