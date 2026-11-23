// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {browserHarness}=require('./browser-harness.cjs');

test('the body turns progressively through all eight directions, carries the collar, and plants both shoes',async()=>{
  const {context}=browserHarness();await context.rigReady;
  const run=code=>vm.runInContext(code,context);
  const measurements=run(`(()=>{
    const config=PROJECT.neck_sway.surface.body_turn;
    if(!config)throw Error('Sample has no full-body direction profile');
    const cx=config.center_x,points=[[cx,460],[cx,620],[cx,710],[cx,830],[cx,1010],[575,1314],[615,1267]];
    const result=[];
    for(const [name,[x,y]] of Object.entries(HEAD_DIRECTIONS)){
      const full=bodyTurnMesh(x,y),half=bodyTurnMesh(x/2,y/2);
      if(!full){if(name!=='center')throw Error('Missing '+name);continue}
      const translate=(point,mesh)=>mapNeckMasterPoint(point,mesh).map((v,i)=>v-point[i]);
      for(const [a,b,c] of full.triangles){
        const [p,q,r]=[a,b,c].map(i=>full.dest[i]);
        if((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])<=0)throw Error('Fold in '+name);
      }
      const left=mapNeckMasterPoint([cx-200,710],full),right=mapNeckMasterPoint([cx+200,710],full);
      const midline=mapNeckMasterPoint([cx,710],full);
      result.push({name,x,y,full:points.map(p=>translate(p,full)),half:points.map(p=>translate(p,half)),
        shoulderWidth:right[0]-left[0],leftDrop:left[1]-midline[1],rightRise:midline[1]-right[1]});
    }
    return result;
  })()`);
  assert.equal(measurements.length,8);
  for(const {name,x,y,full,half,shoulderWidth,leftDrop,rightRise} of measurements){
    for(const [axis,sign] of [x,y].entries()){
      for(const index of [0,1,2,3,4]){
        if(sign){
          assert.ok(full[index][axis]*sign>1,`${name} must move landmark ${index} on axis ${axis}`);
          assert.ok(half[index][axis]*sign>0&&Math.abs(half[index][axis])<Math.abs(full[index][axis]));
        }else assert.ok(Math.abs(full[index][axis])<1e-7);
      }
      for(const shoe of [5,6])assert.ok(Math.abs(full[shoe][axis])<1e-7,`${name} moved foot ${shoe}`);
    }
    if(x){
      assert.ok(shoulderWidth<400,`${name} shoulders did not foreshorten`);
      assert.ok(x*leftDrop>0&&x*rightRise>0,`${name} shoulder heights did not reflect their depth`);
    }
  }
  run('delete PROJECT.neck_sway.surface.body_turn');
  assert.equal(run('bodyTurnMesh(1,-1)'),null);
});

test('render warps the assembled foreground once and keeps the backdrop in screen coordinates',async()=>{
  const {context}=browserHarness();await context.rigReady;
  const counts=vm.runInContext(`(()=>{
    setBackground({...backgroundState,mode:'original'});
    document.querySelector('[data-head-direction="up_right"]').click();
    controls.motionIntensity.value=0;
    const originalTriangle=drawEyeTriangle,originalPart=drawPart;
    let foregroundTriangles=0,backdropLayers=0;
    const backdrop=headBuffer('body:backdrop')[1];
    drawEyeTriangle=(target,image,...rest)=>{
      if(target===backdrop&&image===canvas)foregroundTriangles++;
      return originalTriangle(target,image,...rest);
    };
    drawPart=(image,p,t,amount,eyes,target=ctx)=>{
      if(isBackgroundPart(p)&&target===backdrop)backdropLayers++;
      return originalPart(image,p,t,amount,eyes,target);
    };
    try{render(0);return {foregroundTriangles,expected:bodyTurnFrame.triangles.length,backdropLayers}}
    finally{drawEyeTriangle=originalTriangle;drawPart=originalPart}
  })()`,context);
  assert.equal(counts.foregroundTriangles,counts.expected);
  assert.ok(counts.backdropLayers>=1);
  const pointer=vm.runInContext(`(()=>{
    const pos=mapNeckMasterPoint([470,710],bodyTurnFrame);
    return headPointerPoint({clientX:pos[0],clientY:pos[1]});
  })()`,context);
  assert.ok(Math.hypot(pointer[0]-470,pointer[1]-710)<1e-7);
  vm.runInContext(`controls.motionIntensity.value=1;loadCaptureMotion({format:'ChibiRigMotion',version:1,timeUnit:'seconds',duration:1,loop:false,
    channels:['headYaw','headPitch'],frames:[[0,25,25],[1,25,25]]},'turn');
    $('captureBodyGain').value=0;render(0)`,context);
  assert.equal(vm.runInContext('bodyTurnFrame',context),null);
  vm.runInContext("$('captureBodyGain').value=1;render(0)",context);
  assert.ok(vm.runInContext('bodyTurnFrame',context));
});

test('automatic body follow has the same short delay after a seek or repeated sampling',async()=>{
  const {context}=browserHarness();await context.rigReady;
  const differences=vm.runInContext(`(()=>{
    controls.headEdit.checked=false;controls.neckSway.checked=false;
    controls.motionSpeed.value=1;controls.motionIntensity.value=1;controls.headAmount.value=1;
    headRandomSeed=12345;headRandomStart=0;headRandomFrom=[0,0];
    return ['headRandom','headCircle'].map(mode=>{
      controls.headRandom.checked=mode==='headRandom';controls.headCircle.checked=mode==='headCircle';
      let changes=0;
      for(const t of [0,.8,1.7,3.3,4.8,7.1,1.7,.8]){
        beginHeadFrame(t);const body=bodyTurnAtTime(t),full=bodyTurnMesh(...headAngle);
        const past=neckSwayAngles(Math.max(0,t-.15),1),extent=neckPoseExtent();
        const expected=bodyTurnMesh(past.yaw/extent.yaw,past.pitch/extent.pitch);
        if(JSON.stringify(body)!==JSON.stringify(expected))throw Error(mode+' lost the trajectory at '+t);
        if(JSON.stringify(body)!==JSON.stringify(full))changes++;
      }
      return changes;
    });
  })()`,context);
  assert.ok(differences.every(changes=>changes>0));
});

test('authored body vertices sample their own depth and their triangles reach the canvas',async()=>{
  const {context}=browserHarness();await context.rigReady;
  const report=vm.runInContext(`(()=>{
    const profile=PROJECT.neck_sway.surface.body_turn;
    delete profile.mesh;
    const bands=bodyTurnMesh(1,-1),[chest,shoulder]=profile.rows;
    const index=bands.triangles.findIndex(ids=>{
      const points=ids.map(i=>bands.source[i]);
      return points[0][0]===profile.center_x&&points[0][1]===chest.y&&
        points[1][1]===chest.y&&points[2][1]===shoulder.y;
    });
    if(index<0)throw Error('Missing shoulder band');
    const [a,b,c]=bands.triangles[index],points=bands.source.slice(),joint=points.length;
    const point=[0,1].map(axis=>(points[a][axis]+points[b][axis]+points[c][axis])/3);
    points.push(point);
    const triangles=bands.triangles.slice();
    triangles.splice(index,1,[a,b,joint],[b,c,joint],[c,a,joint]);
    profile.mesh={points,triangles};
    const surface=bodyTurnMesh(1,-1),actual=surface.dest[joint];
    const flat=mapNeckMasterPoint(point,bands),lateral=(point[0]-profile.center_x)/profile.half_width;
    const sample=key=>((chest[key]??0)*2+(shoulder[key]??0))/3;
    const expected=[point[0]+sample('yaw_shift')+sample('depth')*(1-lateral)-sample('narrow')*profile.half_width*lateral,
      point[1]-sample('pitch_shift')-lateral*sample('yaw_rise')];
    document.querySelector('[data-head-direction="up_right"]').click();controls.motionIntensity.value=0;
    const original=drawEyeTriangle,backdrop=headBuffer('body:backdrop')[1];
    let jointDraws=0,bodyDraws=0;
    drawEyeTriangle=(target,image,src,dst)=>{
      if(target===backdrop&&image===canvas){
        bodyDraws++;
        if(src.includes(point))jointDraws++;
      }
      return original(target,image,src,dst);
    };
    try{render(0)}finally{drawEyeTriangle=original}
    return {jointDraws,bodyDraws,triangles:triangles.length,diff:Math.hypot(actual[0]-flat[0],actual[1]-flat[1]),
      error:Math.hypot(actual[0]-expected[0],actual[1]-expected[1])};
  })()`,context);
  assert.ok(report.diff>1,'the joint was only subdivided at its old affine position');
  assert.ok(report.error<1e-7);
  assert.equal(report.jointDraws,3);assert.equal(report.bodyDraws,report.triangles);
});

test('the sample anatomical mesh covers the canvas and stays unfolded between directions',async()=>{
  const {context}=browserHarness();await context.rigReady;
  const report=vm.runInContext(`(()=>{
    const authored=PROJECT.neck_sway.surface.body_turn.mesh;
    if(!authored)throw Error('Missing anatomical body topology in the built player');
    function area(points,[i,j,k]){
      const [a,b,c]=[points[i],points[j],points[k]];
      return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    }
    const sourceAreas=authored.triangles.map(t=>area(authored.points,t));
    let minimum=Math.min(...sourceAreas);
    for(let j=-8;j<=8;j++)for(let i=-8;i<=8;i++){
      const mesh=bodyTurnMesh(i/8,j/8);if(!mesh)continue;
      for(const t of mesh.triangles)minimum=Math.min(minimum,area(mesh.dest,t));
    }
    return {minimum,area:sourceAreas.reduce((sum,v)=>sum+v,0)/2,canvasArea:canvas.width*canvas.height};
  })()`,context);
  assert.ok(report.minimum>1e-5,'a body triangle folded or collapsed');
  assert.ok(Math.abs(report.area-report.canvasArea)<.01,'the triangulated source must cover the canvas');
});
