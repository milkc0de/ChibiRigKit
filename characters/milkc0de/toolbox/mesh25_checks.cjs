#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {geometryContext}=require('./pose_geometry.cjs'),root=path.resolve(__dirname,'..');
const project=JSON.parse(fs.readFileSync(path.join(root,'rig.project.json'))),c=geometryContext(project);
const run=s=>vm.runInContext(s,c);
run('groupMatrix=()=>[1,0,0,1,0,0]');
const report=run(`(()=>{
 const n=PROJECT.neck_sway,extent=neckPoseExtent(),original=neckSwayAngles,parts=Object.values(PROJECT.parts).filter(p=>headPoseActive(p));
 let smallest=Infinity,tests=0,anchorError=0,upAnchorLift=0;
 const index=n.mesh.points.findIndex(v=>v[0]===n.pivot.x&&v[1]===n.pivot.y);
 for(let iy=-25;iy<=25;iy++)for(let ix=-25;ix<=25;ix++){
  neckSwayAngles=()=>({yaw:ix,pitch:iy,roll:0});beginHeadFrame(0);const mesh=neckMasterMesh(0,1);
  if(iy>=0)anchorError=Math.max(anchorError,Math.hypot(mesh.dest[index][0]-n.pivot.x,mesh.dest[index][1]-n.pivot.y));
  else {const lift=n.pivot.y-mesh.dest[index][1];if(lift<0||lift>35)throw Error('chin attachment '+ix+','+iy);upAnchorLift=Math.max(upAnchorLift,lift);}
  for(const [i,j,k] of mesh.triangles){const [a,b,d]=[i,j,k].map(v=>mesh.dest[v]);const cross=(b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]);if(cross<=0)throw Error('fold '+ix+','+iy);smallest=Math.min(smallest,cross)}
  for(const p of parts)if(!validHeadMesh(p,currentHeadSetting(p)))throw Error('part fold '+p.name);
  if(Math.abs(Object.values(headWeights(ix/25,iy/25)).reduce((a,b)=>a+b,0)-1)>1e-10)throw Error('weights');tests++;
 }
 neckSwayAngles=original;controls.neckSway.checked=false;
 // Editing, manual preview and capture must use identical endpoint layouts/meshes.
 let endpointChecks=0,editDeltaError=0,jawChecks=[],mouthChecks=[];
 for(const [name,[x,y]] of Object.entries(HEAD_DIRECTIONS)){
  controls.headEdit.checked=false;controls.headX.value=x;controls.headY.value=y;captureFrame=null;beginHeadFrame(0);
  const manual=neckMasterMesh(0,1).dest,settings=parts.map(p=>currentHeadSetting(p));
  if(x){const mouth=PROJECT.parts.mouth_open,q=mapNeckMasterPoint(headMapPoint(mouth,[503,554],currentHeadSetting(mouth)),neckMasterMesh(0,1));if(x*(q[0]-503)<12)throw Error('Mouth horizontal correction reversed '+name)}
  if(y<0){const mouth=PROJECT.parts.mouth_open,q=mapNeckMasterPoint(headMapPoint(mouth,[503,554],currentHeadSetting(mouth)),neckMasterMesh(0,1));if(q[1]>=544)throw Error('Mouth did not rise '+name);mouthChecks.push({name,dy:q[1]-554})}
  if(x){const q=mapNeckMasterPoint([559,605],neckMasterMesh(0,1));if(x*(q[0]-559)<8)throw Error('Jaw turns backwards '+name);jawChecks.push({name,dx:q[0]-559,dy:q[1]-605})}
  headDirection=name;headDraft=structuredClone(PROJECT.head_pose.poses[name]);controls.headEdit.checked=true;beginHeadFrame(0);
  if(JSON.stringify(manual)!==JSON.stringify(neckMasterMesh(0,1).dest))throw Error('edit mesh mismatch '+name);
  if(JSON.stringify(settings)!==JSON.stringify(parts.map(p=>currentHeadSetting(p))))throw Error('edit layout mismatch '+name);
  const p=PROJECT.parts.face_skin,s=headSetting(p,headDraft),i=12,before=headEditorDest(p,s)[i],delta=headEditorDelta(p,s,i,.01,-.015);
  s.vertices[i][0]+=delta[0];s.vertices[i][1]+=delta[1];const after=headEditorDest(p,s)[i];editDeltaError=Math.max(editDeltaError,Math.hypot(after[0]-before[0]-.01,after[1]-before[1]+.015));
  controls.headEdit.checked=false;captureFrame={headYaw:x*25,headPitch:-y*25};beginHeadFrame(0);
  if(JSON.stringify(manual)!==JSON.stringify(neckMasterMesh(0,1).dest))throw Error('capture mesh mismatch '+name);endpointChecks++;
 }
 captureFrame={headYaw:90,headPitch:-90};beginHeadFrame(0);if(neckCurrentAngles.yaw!==25||neckCurrentAngles.pitch!==25)throw Error('clamp');
 if(Object.values(headWeights(4,-4)).reduce((a,b)=>a+b,0)!==1)throw Error('out of range weights');
 return {extent,anglesTested:tests,minimumTriangleDoubleArea:smallest,anchorError,upAnchorLift,endpointChecks,editDeltaError,jawChecks,mouthChecks,eyeUsesSharedSurface:PROJECT.neck_sway.layout_mode==='coordinated-25-v1'};
})()`);
assert.ok(report.anchorError<1e-8);assert.ok(report.editDeltaError<.002);
// A facial vertex at the old neck pivot must rise with its neighbors, not form
// the downward spike seen when looking up. Test the actual authored surface.
const neck=project.neck_sway,pointIndex=(x,y)=>neck.mesh.points.findIndex(p=>p[0]===x&&p[1]===y);
const chinIndex=pointIndex(neck.pivot.x,neck.pivot.y),left=chinIndex-1,right=chinIndex+1;
const lift=i=>neck.mesh.points[i][1]-neck.poses.up.vertices[i][1];
assert.ok(lift(chinIndex)>10&&lift(chinIndex)<30,'chin must lift gently');
const fraction=(neck.pivot.x-neck.mesh.points[left][0])/(neck.mesh.points[right][0]-neck.mesh.points[left][0]);
assert.ok(Math.abs(lift(chinIndex)-(lift(left)*(1-fraction)+lift(right)*fraction))<3,'isolated chin spike');
assert.equal(neck.surface.pitch_gain,.5);

const baseline=JSON.parse(fs.readFileSync(path.join(root,'work/mesh25-original/rig.project.json')));
assert.deepEqual(project.parts,baseline.parts);assert.deepEqual(project.groups,baseline.groups);assert.deepEqual(project.draw_order,baseline.draw_order);
assert.deepEqual(project.neck_sway.poses.center.vertices,baseline.neck_sway.poses.center.vertices);
// No stale previous-angle layout can overwrite the new coordinated placements.
c.oldHead=baseline.head_pose;assert.throws(()=>run('validateHeadConfig(oldHead)'));
run('validateHeadConfig(PROJECT.head_pose)');
fs.mkdirSync(path.join(root,'work/mesh25'),{recursive:true});fs.writeFileSync(path.join(root,'work/mesh25/geometry-report.json'),JSON.stringify({...report,partsAndAssetsUnchanged:true,oldPoseRejected:true},null,2));console.log(JSON.stringify(report));
