// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {browserHarness}=require('./browser-harness.cjs');
const run=(f,code)=>vm.runInContext(code,f.context);
const plain=value=>JSON.parse(JSON.stringify(value));
async function fixture(){const f=browserHarness();await f.context.rigReady;return f}

test('all nine authored layouts reproduce their local transforms and vertices exactly',async()=>{
 const f=await fixture();
 const checks=run(f,`(()=>{
  controls.headEdit.checked=false;const original=JSON.stringify(PROJECT.head_pose),checks=[];
  for(const [name,[x,y]] of Object.entries(HEAD_DIRECTIONS))for(const pid of PROJECT.head_pose.part_ids){
   const part=PROJECT.parts[pid],expected=headSetting(part,PROJECT.head_pose.poses[name]),actual=mixedHeadSetting(part,x,y);
   for(const key of ['x','y','rotation','scale_x','scale_y'])if(actual[key]!==expected[key])throw Error(name+'/'+pid+'/'+key);
   if(JSON.stringify(actual.vertices)!==JSON.stringify(expected.vertices))throw Error(name+'/'+pid+'/vertices');checks.push(name+'/'+pid);
  }
  if(JSON.stringify(PROJECT.head_pose)!==original)throw Error('sampling changed authored poses');return checks;
 })()`);
 assert.equal(checks.length,9*run(f,'PROJECT.head_pose.part_ids.length'));
});

test('each direction turns the sample face relative to the crown and preserves the eyes',async()=>{
 const f=await fixture();
 const poses=run(f,`(()=>{
  controls.motionIntensity.value=0;
  function landmarks(){
   beginHeadFrame(0);
   const mesh=neckMasterMesh(0,0);
   function point(id,u=.5,v=.5){
    const p=PROJECT.parts[id],setting=currentHeadSetting(p);
    const [x,y]=headMapPoint(p,[p.x+p.w*u,p.y+p.h*v],setting);
    const m=partMatrix(p,0,0,false);
    return mapNeckMasterPoint([m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]],mesh);
   }
   const eyes=['eye_left_sclera','eye_right_sclera'];
   const eyeCenters=eyes.map(id=>point(id));
   return {
    eyes:[0,1].map(axis=>(eyeCenters[0][axis]+eyeCenters[1][axis])/2),
    mouth:point('mouth_open'),crown:point('hair_cap'),
    size:eyes.map(id=>[point(id,1)[0]-point(id,0)[0],point(id,.5,1)[1]-point(id,.5,0)[1]])
   };
  }
  const poses={};
  for(const [name,[x,y]] of Object.entries(HEAD_DIRECTIONS)){
   document.querySelector('[data-head-direction="'+name+'"]').click();
   const full=landmarks();
   controls.headX.value=x/2;controls.headY.value=y/2;
   poses[name]={x,y,full,half:landmarks()};
  }
  return poses;
 })()`);
 const front=poses.center.full,face=run(f,'PROJECT.parts.face_skin');
 for(const [name,{x,y,full,half}] of Object.entries(poses)){
  // A translation of the whole head gives zero. An actual turn brings the
  // face forward relative to the cap, on both axes for a diagonal.
  for(const [axis,sign] of [x,y].entries()){
   if(!sign)continue;
   const minimum=.03*[face.w,face.h][axis];
   for(const feature of ['eyes','mouth']){
    const displacement=pose=>sign*((pose[feature][axis]-pose.crown[axis])-(front[feature][axis]-front.crown[axis]));
    const end=displacement(full),middle=displacement(half);
    assert.ok(end>=minimum,`${name} ${feature} lead on ${axis?'y':'x'}: ${end.toFixed(1)}px (minimum ${minimum.toFixed(1)}px)`);
    assert.ok(middle>0&&middle<end,`${name} ${feature} must turn progressively on ${axis?'y':'x'}`);
   }
  }
  const sizes=full.size.map(([w,h],i)=>[w/front.size[i][0],h/front.size[i][1]]);
  for(const [,height] of sizes)assert.ok(height>=.88&&height<=1.12,`${name} eye height: ${height}`);
  if(x){
   const far=sizes[x<0?0:1][0],near=sizes[x<0?1:0][0];
   assert.ok(far>=.75&&near>=.90&&far+.05<=near,`${name} eye widths: far ${far}, near ${near}`);
  }
 }
});

test('eye layers and closed mouth share their owner deformation at the same canvas point',async()=>{
 const f=await fixture();
 const result=run(f,`(()=>{
  const children=PROJECT.head_pose.part_ids.map(id=>PROJECT.parts[id]).filter(p=>p.transform_from),checks=[];
  for(const child of children){
   const owner=transformOwner(child),grid=headGrid(owner),b=owner.head_bounds;
   const vertices=grid.points.map(([x,y])=>[8*Math.sin((x-b.x)/b.w*Math.PI)*Math.sin((y-b.y)/b.h*Math.PI),5*Math.sin((x-b.x)/b.w*Math.PI)*Math.sin((y-b.y)/b.h*Math.PI)]);
   const setting={x:7,y:-3,rotation:4,scale_x:.96,scale_y:1.02,vertices};
   const pose={parts:{[owner.name]:setting}},inherited=headSetting(child,pose);
   if(JSON.stringify(headGrid(child))!==JSON.stringify(grid))throw Error(child.name+' uses a different source grid');
   for(const u of [.15,.37,.51,.83])for(const v of [.19,.45,.71,.9]){
    const point=[b.x+b.w*u,b.y+b.h*v],a=headMapPoint(owner,point,setting),c=headMapPoint(child,point,inherited);
    if(Math.hypot(a[0]-c[0],a[1]-c[1])>1e-8)throw Error(child.name+' drifts from '+owner.name);checks.push(child.name);
   }
  }
  return {children:children.length,checks:checks.length};
 })()`);
 assert.ok(result.children>=7);assert.equal(result.checks,result.children*16);
});

test('authored head and eye scale reaches canvas transforms and survives the shared master warp',async()=>{
 const f=await fixture();
 const report=run(f,`(()=>{
  const n=PROJECT.neck_sway,eye=PROJECT.parts.eye_left_sclera,iris=PROJECT.parts.eye_left_iris,face=PROJECT.parts.face_skin;
  const saved={headBuffer,drawPart,drawEyeTriangle,hairDeformedPoint,neckSwayAngles,partMatrix},transforms={},triangleCounts={},patched=new Set();
  const dimensions=(p,setting,mesh)=>{
   const points=[[p.x,p.y],[p.x+p.w,p.y],[p.x+p.w,p.y+p.h],[p.x,p.y+p.h]].map(point=>mapNeckMasterPoint(headMapPoint(p,point,setting),mesh));
   return [Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))];
  };
  try{
   n.layout_mode='authored-25-v1';controls.headEdit.checked=false;headAngle=[1,0];
   PROJECT.head_pose.poses.right.parts[eye.name]={...neutralHeadSetting(),scale_x:1.24,scale_y:.78};
   delete PROJECT.head_pose.poses.right.parts[iris.name];
   PROJECT.head_pose.poses.right.parts[face.name]={...neutralHeadSetting(),scale_x:.86,scale_y:1.16};
   const pivot=n.pivot; n.poses.right.vertices=n.mesh.points.map(([x,y])=>[pivot.x+(x-pivot.x)*1.08,pivot.y+(y-pivot.y)*.92]);
   neckSwayAngles=()=>({yaw:n.yaw_extent,pitch:0,roll:0});partMatrix=()=>[1,0,0,1,0,0];
   drawPart=()=>{};hairDeformedPoint=(_p,_source,dest)=>dest;
   headBuffer=(key,...args)=>{
    const [surface,c]=saved.headBuffer(key,...args);c.geometryAuditKey=key;
    if(!patched.has(c)){patched.add(c);const original=c.setTransform;c.setTransform=(...matrix)=>{(transforms[c.geometryAuditKey]??=[]).push(matrix);original.apply(c,matrix)}}
    return [surface,c];
   };
   drawEyeTriangle=(target,_image,_source,_dest)=>triangleCounts[target.geometryAuditKey]=(triangleCounts[target.geometryAuditKey]||0)+1;
   headFrameCache.clear();neckMasterFrame=null;renderHeadSurface(iris,0,0,1);renderHeadSurface(face,0,0,1);
   const mesh=neckMasterMesh(0,0),eyeSize=dimensions(eye,currentHeadSetting(eye),mesh),irisSize=dimensions(iris,currentHeadSetting(iris),mesh),faceSize=dimensions(face,currentHeadSetting(face),mesh);
   return {transforms,triangleCounts,ratios:{eye:[eyeSize[0]/eye.w,eyeSize[1]/eye.h],iris:[irisSize[0]/iris.w,irisSize[1]/iris.h],face:[faceSize[0]/face.w,faceSize[1]/face.h]}};
  }finally{headBuffer=saved.headBuffer;drawPart=saved.drawPart;drawEyeTriangle=saved.drawEyeTriangle;hairDeformedPoint=saved.hairDeformedPoint;neckSwayAngles=saved.neckSwayAngles;partMatrix=saved.partMatrix;headFrameCache.clear();neckMasterFrame=null}
 })()`);
 for(const [name,sx,sy] of [['eye_left_sclera',1.24,.78],['eye_left_iris',1.24,.78],['face_skin',.86,1.16]]){
  assert.ok(report.transforms[`warped:${name}:part`].some(matrix=>Math.abs(matrix[0]-sx)<1e-10&&Math.abs(matrix[3]-sy)<1e-10),`${name} scale was omitted from the canvas draw`);
  assert.ok(report.triangleCounts[`world:${name}:part`]>0,`${name} did not use the authored master mesh`);
 }
 for(const name of ['eye','iris']){assert.ok(Math.abs(report.ratios[name][0]-1.24*1.08)<1e-8);assert.ok(Math.abs(report.ratios[name][1]-.78*.92)<1e-8)}
 assert.ok(Math.abs(report.ratios.face[0]-.86*1.08)<1e-8);assert.ok(Math.abs(report.ratios.face[1]-1.16*.92)<1e-8);
});

test('axis joins and authored limits remain continuous for local placement and mesh vertices',async()=>{
 const f=await fixture();
 const largest=run(f,`(()=>{
  let largest=0;const epsilon=1e-7;
  for(const axis of [0,1])for(const join of [-1,-.1,0,.1,1])for(const other of [-1,-.43,0,.52,1])for(const pid of PROJECT.head_pose.part_ids){
   const before=axis===0?[join-epsilon,other]:[other,join-epsilon],after=axis===0?[join+epsilon,other]:[other,join+epsilon],p=PROJECT.parts[pid];
   const a=headDest(p,mixedHeadSetting(p,...before)),b=headDest(p,mixedHeadSetting(p,...after));
   for(let i=0;i<a.length;i++)largest=Math.max(largest,Math.hypot(a[i][0]-b[i][0],a[i][1]-b[i][1]));
  }return largest;
 })()`);
 assert.ok(largest<.001,`a pose boundary moves ${largest} pixels across a tiny angle change`);
});

test('local meshes, the neck lattice and their composition stay oriented between authored directions',async()=>{
 const f=await fixture();
 const result=run(f,`(()=>{
  const originalSampler=neckSwayAngles,n=PROJECT.neck_sway,area=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  let minLocal=Infinity,minMaster=Infinity,minCombined=Infinity,localChecks=0,masterChecks=0,combinedChecks=0;
  try{
   for(let yi=0;yi<=24;yi++)for(let xi=0;xi<=24;xi++){
    const x=xi/12-1,y=yi/12-1;headAngle=[x,y];neckSwayAngles=()=>({yaw:x*n.yaw_extent,pitch:y*n.pitch_extent,roll:7});neckMasterFrame=null;
    const master=neckMasterMesh(0,0),left=Math.min(...master.source.map(p=>p[0])),right=Math.max(...master.source.map(p=>p[0])),top=Math.min(...master.source.map(p=>p[1])),bottom=Math.max(...master.source.map(p=>p[1]));
    for(const [i,j,k] of master.triangles){minMaster=Math.min(minMaster,area(master.dest[i],master.dest[j],master.dest[k]));masterChecks++}
    for(const pid of PROJECT.head_pose.part_ids){
     const p=PROJECT.parts[pid],grid=headGrid(p),dest=headDest(p,currentHeadSetting(p));
     for(const [i,j,k] of grid.triangles){minLocal=Math.min(minLocal,area(dest[i],dest[j],dest[k]));localChecks++}
     if(xi%4||yi%4||p.transform_from)continue;
     const base=partMatrix(p,0,0,false),source=dest.map(([px,py])=>[base[0]*px+base[2]*py+base[4],base[1]*px+base[3]*py+base[5]]),combined=source.map(point=>mapNeckMasterPoint(point,master));
     // The renderer draws only the master's source domain; negative transparent
     // padding above the canvas is deliberately outside that rendered surface.
     for(const [i,j,k] of grid.triangles){if([i,j,k].some(index=>{const [px,py]=source[index];return px<left||px>right||py<top||py>bottom}))continue;minCombined=Math.min(minCombined,area(combined[i],combined[j],combined[k]));combinedChecks++}
    }
   }
  }finally{neckSwayAngles=originalSampler;neckMasterFrame=null}
  return {minLocal,minMaster,minCombined,localChecks,masterChecks,combinedChecks};
 })()`);
 assert.ok(result.minLocal>.0001,JSON.stringify(plain(result)));assert.ok(result.minMaster>.0001,JSON.stringify(plain(result)));assert.ok(result.minCombined>.0001,JSON.stringify(plain(result)));
 assert.ok(result.localChecks>100000);assert.ok(result.masterChecks>100000);assert.ok(result.combinedChecks>10000);
});

test('shared authored layouts apply local correction and the neck master exactly once',async()=>{
 const f=await fixture();
 const result=run(f,`(()=>{
  const n=PROJECT.neck_sway,p=PROJECT.parts.face_skin,point=[p.x+p.w*.5,p.y+p.h*.5];
  n.layout_mode='coordinated-25-v1';controls.headEdit.checked=false;controls.headRandom.checked=false;controls.headCircle.checked=false;controls.neckSway.checked=true;
  controls.headX.value=1;controls.headY.value=-1;controls.motionIntensity.value=1;
  for(const [name,[x,y]] of Object.entries(HEAD_DIRECTIONS)){
   n.poses[name].vertices=n.mesh.points.map(([px,py])=>[px+x*13,py+y*9]);
   n.poses[name].parts={[p.name]:{x:111,y:222,rotation:35,scale_x:1.8,scale_y:1.7}};
   PROJECT.head_pose.poses[name].parts[p.name]={...neutralHeadSetting(),x:7};
  }
  return ['coordinated-25-v1','authored-25-v1'].map(mode=>{
   n.layout_mode=mode;beginHeadFrame(0);const setting=currentHeadSetting(p),local=headMapPoint(p,point,setting),world=mapNeckMasterPoint(local,neckMasterMesh(0,0));
   return {point,local,world,x:setting.x,y:setting.y,scale_x:setting.scale_x};
  });
 })()`);
 for(const value of result){assert.equal(value.x,7);assert.equal(value.y,0);assert.equal(value.scale_x,1);assert.ok(Math.abs(value.local[0]-value.point[0]-7)<1e-8);assert.ok(Math.abs(value.world[0]-value.point[0]-20)<1e-8);assert.ok(Math.abs(value.world[1]-value.point[1]+9)<1e-8)}
});

test('roll rotates the entire neck lattice once about its shared attachment',async()=>{
 const f=await fixture();
 const error=run(f,`(()=>{
  const originalSampler=neckSwayAngles,n=PROJECT.neck_sway;let error=0;
  try{for(const pose of Object.values(n.poses))pose.vertices=structuredClone(n.mesh.points);
   for(const roll of [-30,-12,0,17,30]){
    neckSwayAngles=()=>({yaw:0,pitch:0,roll});neckMasterFrame=null;
    const mesh=neckMasterMesh(0,0),r=around(n.pivot,roll,0,0);
    for(let i=0;i<n.mesh.points.length;i++){const [x,y]=n.mesh.points[i],expected=[r[0]*x+r[2]*y+r[4],r[1]*x+r[3]*y+r[5]];error=Math.max(error,Math.hypot(mesh.dest[i][0]-expected[0],mesh.dest[i][1]-expected[1]))}
   }
  }finally{neckSwayAngles=originalSampler;neckMasterFrame=null}return error;
 })()`);
 assert.ok(error<1e-8,`roll error ${error}`);
});

test('import rejects nonfolded endpoints that collapse while interpolating',async()=>{
 const f=await fixture();
 run(f,`let collapsing=structuredClone(PROJECT.head_pose);const foldPart=PROJECT.parts.face_skin,foldGrid=headGrid(foldPart),foldPivot=transformOwner(foldPart).pivot;
  for(const [name,sign] of [['left',1],['center',-1]])collapsing.poses[name].parts[foldPart.name]={...neutralHeadSetting(),vertices:foldGrid.points.map(([x,y])=>{
   const dx=x-foldPivot.x,dy=y-foldPivot.y;return [foldPivot.x-sign*dy-x,foldPivot.y+sign*dx-y];
  })};controls.headEdit.checked=true;`);
 assert.equal(run(f,'validHeadMesh(foldPart,{...neutralHeadSetting(),...collapsing.poses.left.parts[foldPart.name]})'),true);assert.equal(run(f,'validHeadMesh(foldPart,{...neutralHeadSetting(),...collapsing.poses.center.parts[foldPart.name]})'),true);
 assert.throws(()=>f.context.validateHeadConfig(run(f,'collapsing')),/折り返/);assert.equal(f.elements.get('headEdit').checked,true);
});
