// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
window.runNeckChecks=()=>{
  if(!PROJECT.neck_sway)return {enabled:false};
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)},original=collectMotionProject(),oldSeed=headRandomSeed;
  const same=(a,b)=>a.every((n,i)=>Math.abs(n-b[i])<1e-8),n=PROJECT.neck_sway;
  const sheet=document.createElement('canvas');sheet.width=1080;sheet.height=470;const g=sheet.getContext('2d');
  try{
    running=false;headRandomSeed=12345;controls.headRandom.checked=false;controls.headCircle.checked=false;
    controls.headX.value=0;controls.headY.value=0;controls.autoBlink.checked=false;controls.autoExpression.checked=false;
    controls.manualEyeOpen.checked=true;controls.eyeOpenTest.value=1;controls.expression.value=0;
    controls.neckSway.checked=true;controls.neckAmount.value=6;controls.motionIntensity.value=1;
    const times=Array.from({length:601},(_,i)=>i/20),min=times.reduce((a,b)=>neckSwayAngle(a,1)<neckSwayAngle(b,1)?a:b),max=times.reduce((a,b)=>neckSwayAngle(a,1)>neckSwayAngle(b,1)?a:b);
    const samples=[],renders=[];let pupilClipChecks=0;
    for(const [index,t] of [min,0,max].entries()){
      const angle=neckSwayAngle(t,1),angles=neckSwayAngles(t,1),on=Object.fromEntries(Object.entries(PROJECT.parts).map(([id,p])=>[id,partMatrix(p,t,1)]));
      controls.neckSway.checked=false;
      for(const [id,p] of Object.entries(PROJECT.parts))if(!n.part_ids.includes(id))assert(same(partMatrix(p,t,1),on[id]),'Neck moved body layer '+id);
      controls.neckSway.checked=true;
      const shared=neckSwayMatrix(PROJECT.parts[n.anchor_part],t,1);
      for(const id of n.part_ids)assert(same(shared,neckSwayMatrix(PROJECT.parts[id],t,1)),'Different neck pivot for '+id);
      render(t);renders.push(canvas.toDataURL());samples.push({time:t,angle,...angles});
      for(const p of Object.values(PROJECT.parts).filter(p=>p.kind==='eye_iris')){
        const iris=renderHeadSurface(p,t,1,1).getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        const sclera=renderHeadSurface(PROJECT.parts[p.clip_to],t,1,1).getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        for(let i=3;i<iris.length;i+=4)assert(!iris[i]||sclera[i]>0,'Pupil escaped during neck rotation');pupilClipChecks++;
      }
      g.fillStyle='#e9dfd3';g.fillRect(index*360,0,360,470);const ratio=Math.min(350/canvas.width,435/canvas.height);g.drawImage(canvas,index*360+(360-canvas.width*ratio)/2,0,canvas.width*ratio,canvas.height*ratio);
      g.fillStyle='#222';g.font='16px sans-serif';g.fillText(angle.toFixed(2)+'°',index*360+20,460);
    }
    assert(new Set(renders).size===3,'Neck rotation did not change pixels');
    // Review each authored yaw/pitch endpoint before accepting interpolation.
    const sampler=neckSwayAngles;sheet.height=1380;let directionIndex=0;
    try{for(const [name,[yaw,pitch]] of Object.entries(HEAD_DIRECTIONS)){
      neckSwayAngles=()=>({yaw:yaw*n.yaw_extent,pitch:pitch*n.pitch_extent,roll:0});render(0);
      const x=directionIndex%3*360,y=Math.floor(directionIndex/3)*460;g.fillStyle='#e9dfd3';g.fillRect(x,y,360,460);
      const ratio=430/canvas.height;g.drawImage(canvas,x+(360-canvas.width*ratio)/2,y,canvas.width*ratio,430);
      g.fillStyle='#222';g.font='16px sans-serif';g.fillText(HEAD_LABELS[name],x+16,y+450);directionIndex++;
    }}finally{neckSwayAngles=sampler}
    controls.neckAmount.value=12;const saved=collectMotionPreset();controls.neckSway.checked=false;controls.neckAmount.value=0;applyMotionProject(saved);running=false;
    assert(controls.neckSway.checked&&Number(controls.neckAmount.value)===12,'Neck JSON roundtrip failed');
    $('reset').click();running=false;assert(controls.neckSway.checked&&Number(controls.neckAmount.value)===6,'Neck reset failed');
    return {enabled:true,headParts:n.part_ids.length,masterVertices:n.mesh?.points.length,referenceLayouts:Object.keys(n.poses||{}).length,samples,bodyUnchanged:true,pupilClipChecks,jsonRoundtrip:true,reset:true,png:sheet.toDataURL().split(',')[1]};
  }finally{headRandomSeed=oldSeed;applyMotionProject(original);running=false}
};
