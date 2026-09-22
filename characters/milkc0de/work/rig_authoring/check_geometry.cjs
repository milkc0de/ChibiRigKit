// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
// Executes the production geometry functions in Node. This is NOT a browser-renderer pass.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const root=path.resolve(__dirname,'../..');
const PROJECT=JSON.parse(fs.readFileSync(path.join(root,'rig.project.json'),'utf8'));
const source=fs.readFileSync(path.join(root,'runtime/index.template.html'),'utf8')+'\n'+fs.readFileSync(path.join(root,'runtime/head_pose.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert(start>=0,name);let i=source.indexOf('{',start),depth=0;for(;i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&--depth===0)return source.slice(start,i+1)}throw Error(name)}
const controls={duration:{value:5},motionSpeed:{value:1},headEdit:{checked:false},manualMouthOpen:{checked:true},mouthOpenTest:{value:1}};
const D={up_left:[-1,-1],up:[0,-1],up_right:[1,-1],left:[-1,0],center:[0,0],right:[1,0],down_left:[-1,1],down:[0,1],down_right:[1,1]};
const context={PROJECT,controls,HEAD_DIRECTIONS:D,$:(id)=>({value:1}),headDraft:null,headDirection:'center',canvas:{width:1152,height:1366},document:{createElement:()=>({})},eyeMeshCache:new WeakMap(),Math,console};
vm.createContext(context);
for(const name of ['mul','around','evalMotion','groupMatrix','smoothstep','mouthOpenValue','eyeSwap','partOpacity','transformOwner','partMatrix','radialEyeMesh','deformEyePoint','headWeights','neutralHeadSetting','headSetting','mixedHeadSetting','headGrid','headDest','validHeadMesh','irisGazeOffset','headNoise','randomHeadTarget','randomHeadAngle'])vm.runInContext(fn(name),context);
let geometry=0,combos=0,pairs=0;
for(const eye of [0,.005,.5,1])for(const mouth of [0,.1,.5,1])for(const expr of [0,.5,1]){
 controls.mouthOpenTest.value=mouth;
 for(const p of Object.values(PROJECT.parts)){
  const op=context.partOpacity(p,expr,eye);assert(Number.isFinite(op)&&op>=0&&op<=1);
  if(['eye_sclera','eye_iris'].includes(p.kind)&&eye===0)assert.equal(op,0);
  if(p.kind==='drawn_eye_closed'&&eye===1)assert.equal(op,0);
  if(p.kind==='mouth_open'&&mouth===0)assert.equal(op,0);
  if(p.kind==='mouth_closed'&&mouth===0)assert.equal(op,1);
  if(p.closed_part){assert.equal(JSON.stringify(context.partMatrix(p,.71,4)),JSON.stringify(context.partMatrix(PROJECT.parts[p.closed_part],.71,4)));pairs++;}
  if(p.mesh?.type==='blink_eye_radial'){
   const m=context.radialEyeMesh(p),d=m.points.map(pt=>context.deformEyePoint(p,pt,eye));
   for(const tri of m.triangles){const [a,b,c]=tri.map(i=>d[i]);assert((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0);geometry++;}
  }
 }combos++;
}
for(const p of Object.values(PROJECT.parts).filter(p=>p.kind==='eye_sclera')){const gaze=context.irisGazeOffset(p);assert(gaze[0]>0&&gaze[0]<=p.w*.06&&gaze[1]>0&&gaze[1]<=p.h*.05);}
let poseChecks=0;for(let y=-1;y<=1;y+=.125)for(let x=-1;x<=1;x+=.125)for(const id of PROJECT.head_pose.part_ids){assert(context.validHeadMesh(PROJECT.parts[id],context.mixedHeadSetting(PROJECT.parts[id],x,y)));poseChecks++;}
let prev;for(let i=0;i<240;i++){const p=context.randomHeadAngle(i*.1,12345);assert(p.every(x=>Number.isFinite(x)&&Math.abs(x)<=1));assert.equal(JSON.stringify(p),JSON.stringify(context.randomHeadAngle(i*.1,12345)));if(prev)assert(Math.hypot(p[0]-prev[0],p[1]-prev[1])<.15);prev=p;}
// Exact production matrices/settings feed the separate offline raster preview.
const frames=[];
for(const [name,angle] of Object.entries(D))frames.push({name,angle,t:.37,intensity:0,eye:1,mouth:1,gaze:angle});
for(let i=0;i<16;i++)frames.push({name:`motion_${i}`,angle:[0,0],t:i*5/16,intensity:4,eye:[1,.5,.005,0][i%4],mouth:[1,.5,0,1][i%4],gaze:[0,0]});
for(let i=0;i<8;i++)frames.push({name:`random_sway_${i}`,angle:context.randomHeadAngle(i*2.3,12345),t:i*.3,intensity:1,eye:1,mouth:1,gaze:[0,0]});
for(const frame of frames){controls.mouthOpenTest.value=frame.mouth;frame.parts={};for(const [id,p] of Object.entries(PROJECT.parts)){
 const q={matrix:context.partMatrix(p,frame.t,frame.intensity),opacity:context.partOpacity(p,0,frame.eye)};
 if(PROJECT.head_pose.part_ids.includes(id)){q.head={source:context.headGrid(p).points,dest:context.headDest(p,context.mixedHeadSetting(p,...frame.angle)),triangles:context.headGrid(p).triangles};}
 if(p.mesh?.type==='blink_eye_radial'){const m=context.radialEyeMesh(p);q.eye={source:m.points.map(pt=>[pt[0]+p.x,pt[1]+p.y]),dest:m.points.map(pt=>context.deformEyePoint(p,pt,frame.eye)),triangles:m.triangles};}
 frame.parts[id]=q;
}}
fs.writeFileSync(path.join(root,'work/rig_authoring/offline_frames.json'),JSON.stringify(frames));
const report={scope:'Production JavaScript geometry and expression functions in Node; no browser or Canvas execution',combinations:combos,positiveEyeTriangles:geometry,pairedTransformChecks:pairs,headMeshChecks:poseChecks,randomSamples:240,passed:true,browser:{status:'blocked',headless:'Chrome launch SIGABRT in sandbox',interactive:'Local-file URL rejected by browser security policy'}};
fs.writeFileSync(path.join(root,'checks/geometry-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
