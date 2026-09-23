// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
/* Shared by automated Chrome validation and the inspectable browser harness. */
window.runRigChecks=()=>{
      running=false;controls.headRandom.checked=false;controls.headCircle.checked=false;
      const assert=(ok,message)=>{if(!ok)throw Error(message)};
      controls.autoBlink.checked=false;controls.autoExpression.checked=false;
      controls.manualEyeOpen.checked=true;controls.manualMouthOpen.checked=true;
      const sheet=document.createElement('canvas');sheet.width=1280;sheet.height=960;
      const g=sheet.getContext('2d');g.fillStyle='#303036';g.fillRect(0,0,sheet.width,sheet.height);
      const checks=[];
      for(const eye of [0,.005,.5,1])for(const mouth of [0,.1,.5,1])for(const expr of [0,.5,1]){
        controls.eyeOpenTest.value=eye;controls.mouthOpenTest.value=mouth;controls.expression.value=expr;
        for(const p of Object.values(PROJECT.parts)){
          const op=partOpacity(p,expr,eye);assert(Number.isFinite(op)&&op>=0&&op<=1,`${p.name}: invalid opacity`);
          if(['eye_open','eye_sclera','eye_iris','eye_line'].includes(p.kind)&&eye===0)assert(op===0,'Open eye survives full closure');
          if(['drawn_eye_closed','eye_closed'].includes(p.kind)&&eye===1)assert(op===0,'Closed eye visible while open');
          if(['mouth_open','mouth_smile'].includes(p.kind)&&mouth===0)assert(op===0,'Open mouth survives full closure');
          if(p.kind==='mouth_closed'&&mouth===0)assert(op===(p.opacity??1),'Closed mouth endpoint');
          if(p.kind==='blush')assert(op===(p.opacity??1),'Blush must survive blink/expression');
          if(p.closed_part)assert(JSON.stringify(partMatrix(p,.71,4))===JSON.stringify(partMatrix(PROJECT.parts[p.closed_part],.71,4)),'Paired endpoints drift');
          if(p.mesh?.type==='blink_eye_radial'){
            const m=radialEyeMesh(p),dest=m.points.map(pt=>deformEyePoint(p,pt,eye));
            for(const tri of m.triangles){const [a,b,c]=tri.map(i=>dest[i]);assert((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0,'Eye triangle inverted')}
          }
        }
        checks.push({eye,mouth,expr});render(.71);
      }
      const pixels=()=>ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
      // Fractional, rotated strip boundaries used to create visible lines even at zero deformation.
      const testSurface=document.createElement('canvas');testSurface.width=256;testSurface.height=256;
      const tc=testSurface.getContext('2d',{willReadFrequently:true});
      const texture=document.createElement('canvas');texture.width=103;texture.height=101;
      const tx=texture.getContext('2d');tx.fillStyle='#c9a37b';tx.fillRect(0,0,103,101);
      const neutralPart={x:64,y:64,w:103,h:101,mesh:{slices:8,amp_px:0,squash_pct:0}};
      const clearTest=()=>{tc.setTransform(1,0,0,1,0,0);tc.clearRect(0,0,256,256)};
      const transformedTest=draw=>{clearTest();tc.setTransform(...around({x:120,y:120},.85,1.3,.7));draw();return tc.getImageData(0,0,256,256).data};
      const rigidReference=transformedTest(()=>drawRigid(texture,neutralPart,tc));
      for(const draw of [drawSoftBody,drawBendVertical])assert(same(rigidReference,transformedTest(()=>draw(texture,neutralPart,1.25,1,tc))),'Neutral mesh creates cracks under rotation');
      let automaticGazeChecks=0;
      const savedGaze=[$('gazeX').value,$('gazeY').value],savedRandom=controls.headRandom.checked,savedAngle=[...headAngle];
      try{
        controls.headRandom.checked=true;$('gazeX').value=0;$('gazeY').value=0;
        for(const p of Object.values(PROJECT.parts).filter(p=>p.kind==='eye_iris')){
          const owner=PROJECT.parts[p.clip_to];if((owner.mesh?.gaze_x_ratio??.10)===0)continue;
          const s=document.createElement('canvas');s.width=canvas.width;s.height=canvas.height;const c=s.getContext('2d',{willReadFrequently:true});
          headAngle=[-.8,0];drawSplitEye(images[p.file],p,0,0,1,c);const left=c.getImageData(0,0,s.width,s.height).data;
          headAngle=[.8,0];c.clearRect(0,0,s.width,s.height);drawSplitEye(images[p.file],p,0,0,1,c);
          assert(!same(left,c.getImageData(0,0,s.width,s.height).data),'Automatic pupil gaze is static');automaticGazeChecks++;
        }
      }finally{controls.headRandom.checked=savedRandom;headAngle=savedAngle;[$('gazeX').value,$('gazeY').value]=savedGaze}
      // Geometry, not just opacity: mouth half-open changes its own pixels only.
      const mouths=Object.values(PROJECT.parts).filter(p=>p.kind==='mouth_open'&&p.mesh?.type==='mouth_open_close');
      for(const p of mouths){
        const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;
        const x=c.getContext('2d',{willReadFrequently:true});
        drawMouthOpenClose(images[p.file],p,1,x);const full=x.getImageData(0,0,c.width,c.height).data;
        x.clearRect(0,0,c.width,c.height);drawMouthOpenClose(images[p.file],p,.5,x);
        assert(!same(full,x.getImageData(0,0,c.width,c.height).data),'Half-open mouth did not deform');
      }
      controls.motionIntensity.value=0;controls.eyeOpenTest.value=1;controls.mouthOpenTest.value=1;controls.expression.value=0;
      controls.showSeams.checked=false;render(0);const withoutSeams=pixels();
      controls.showSeams.checked=true;render(0);const withSeams=pixels();
      const seamChangedChannels=withSeams.reduce((n,v,i)=>n+(v!==withoutSeams[i]),0);
      const snapshots=[];
      for(let i=0;i<16;i++){
        const t=i*parseFloat(controls.duration.value)/16;
        controls.motionIntensity.value=4;controls.eyeOpenTest.value=[1,.5,.005,0][i%4];
        controls.mouthOpenTest.value=[1,.5,0,1][i%4];controls.expression.value=i>=8?1:0;
        controls.showSeams.checked=true;render(t);const first=pixels();
        render(t+.173);render(t);{const next=pixels();let changed=0,maxDelta=0;for(let j=0;j<first.length;j++){if(first[j]!==next[j])changed++;maxDelta=Math.max(maxDelta,Math.abs(first[j]-next[j]))}assert(same(first,next),`Previous frame left a trail: frame ${i}, channels ${changed}, max delta ${maxDelta}`)};
        const ratio=Math.min(300/canvas.width,204/canvas.height),w=canvas.width*ratio,h=canvas.height*ratio;
        g.drawImage(canvas,i%4*320+(320-w)/2,Math.floor(i/4)*240,w,h);
        g.fillStyle='#fff';g.font='13px sans-serif';g.fillText(`t=${t.toFixed(2)} eye=${controls.eyeOpenTest.value} mouth=${controls.mouthOpenTest.value}`,i%4*320+8,Math.floor(i/4)*240+225);
        snapshots.push(t);
      }
      controls.showBaseOnly.checked=true;controls.showSeams.checked=false;render(0);const base=pixels();
      controls.showSeams.checked=true;render(0);assert(same(base,pixels()),'Seam correction altered base-only view');
      const chosen=PROJECT.parts[$('partSelect').value];if(chosen){chosen.motion.rot_deg=9;}
      $('reset').click();running=false;
      assert(!controls.manualEyeOpen.checked&&!controls.manualMouthOpen.checked,'Reset manual overrides');
      assert(JSON.stringify(PROJECT.parts)===JSON.stringify(initialParts),'Reset failed to restore edited part settings');
      controls.mouthOpenTest.value=.5;controls.mouthOpenTest.dispatchEvent(new Event('input'));
      assert(controls.manualMouthOpen.checked&&$('mouthOpenOut').textContent==='0.50','Mouth slider/manual UI');
      $('reset').click();running=false;
      return {automaticGazeChecks,neutralMeshUnderRotationChecks:2,motionIO:window.runMotionIOChecks(),neck:window.runNeckChecks(),head:window.runHeadChecks(),combinations:checks.length,motionFrames:snapshots.length,trailCheck:true,basePreserved:true,reset:true,mouthDeformationChecks:mouths.length,seamChangedChannels,png:sheet.toDataURL().split(',')[1]};

};
