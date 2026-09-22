#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {geometryContext}=require('./pose_geometry.cjs');
const root=path.resolve(__dirname,'..'),project=JSON.parse(fs.readFileSync(path.join(root,'rig.project.json')));
const c=geometryContext(project),run=s=>vm.runInContext(s,c);
const report=run(`(()=>{
 controls.neckSway.checked=false;
 let frames=0,minimumArea=Infinity,minimumOverlap=Infinity;
 for(const yaw of [-25,0,25])for(const roll of [-20,0,20])for(let step=1;step<=100;step++){
  const t=step/10;captureFrame={headYaw:yaw,headPitch:step/4,headRoll:roll};beginHeadFrame(t);
  const g=neckFillGeometry(t,1);if(!g)throw Error('missing upward join');
  for(const ids of g.triangles){const [a,b,d]=ids.map(i=>g.dest[i]);const area=(b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]);if(area<=0)throw Error('join fold');minimumArea=Math.min(minimumArea,area)}
  // The original chin at x=535,y=617 must lie INSIDE the opaque bridge,
  // not on its top edge; measure signed inward distances from every edge.
  const face=PROJECT.parts[PROJECT.neck_sway.anchor_part],m=partMatrix(face,t,1,false);
  const q=headMapPoint(face,[535,617],currentHeadSetting(face));
  const chin=mapNeckMasterPoint([m[0]*q[0]+m[2]*q[1]+m[4],m[1]*q[0]+m[3]*q[1]+m[5]],neckMasterMesh(t,1));
  for(let i=0;i<4;i++){const a=g.dest[i],b=g.dest[(i+1)%4],dx=b[0]-a[0],dy=b[1]-a[1];const overlap=(dx*(chin[1]-a[1])-dy*(chin[0]-a[0]))/Math.hypot(dx,dy);if(overlap<5)throw Error('chin not covered '+overlap);minimumOverlap=Math.min(minimumOverlap,overlap)}
  frames++;
 }
 captureFrame={headPitch:0};beginHeadFrame(0);if(neckFillGeometry(0,1)!==null)throw Error('neutral patch visible');
 captureFrame={headPitch:-25};beginHeadFrame(0);if(neckFillGeometry(0,1)!==null)throw Error('downward patch visible');
 // Independent head motion must move the top seam while the lower seam remains
 // attached to the body, including the head's existing roll/breathing motion.
 captureFrame={headPitch:12.5};beginHeadFrame(0);
 const originalGroup=groupMatrix;let shift=0;
 groupMatrix=(name,t,i)=>{const m=originalGroup(name,t,i);if(name==='head_sway')m[4]+=shift;return m};
 beginHeadFrame(0);const a=neckFillGeometry(0,1);shift=12;beginHeadFrame(0);const b=neckFillGeometry(0,1);
 if(Math.hypot(a.dest[0][0]-b.dest[0][0],a.dest[0][1]-b.dest[0][1])<8)throw Error('top does not follow head');
 if(JSON.stringify(a.dest.slice(2))!==JSON.stringify(b.dest.slice(2)))throw Error('bottom detached from body');
 groupMatrix=originalGroup;
 return {frames,minimumTriangleDoubleArea:minimumArea,minimumChinOverlapPixels:minimumOverlap,headAndBodyAttachment:true};
})()`);
// Check the actual draw path does not fade the bridge at intermediate angles.
run(`let fills=0;const images={[PROJECT.neck_fill.file]:{}};const ctx={globalAlpha:0,save(){},restore(){},setTransform(){}};
function drawEyeTriangle(){if(ctx.globalAlpha!==1)throw Error('transparent neck join');fills++}
captureFrame={headPitch:1};beginHeadFrame(0);drawNeckFill(0,1);if(fills!==2)throw Error('bridge not drawn');`);
assert.equal(report.frames,900);
fs.mkdirSync(path.join(root,'work/neck-join'),{recursive:true});fs.writeFileSync(path.join(root,'work/neck-join/checks.json'),JSON.stringify({...report,intermediatePoseOpaque:true,browserRendering:'not verified'},null,2));
console.log(JSON.stringify(report));
