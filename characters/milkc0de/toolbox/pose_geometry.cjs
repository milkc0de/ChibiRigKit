#!/usr/bin/env node
// Evaluate renderer geometry in Node, without a browser or raster canvas.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function geometryContext(project,headSource){
 const c=vm.createContext({PROJECT:project,structuredClone,crypto:require('node:crypto').webcrypto,canvas:{width:project.canvas.width,height:project.canvas.height}});
 vm.runInContext(`const els=new Map();const $=id=>{if(!els.has(id))els.set(id,{value:0,checked:false});return els.get(id)};
 const controls=new Proxy({}, {get:(_,id)=>$(id)});controls.motionSpeed.value=1;controls.motionIntensity.value=1;controls.headAmount.value=1;controls.neckSway.checked=true;
 let geometryAxisGains={Yaw:1,Pitch:1,Roll:1};const captureAxisGain=axis=>geometryAxisGains[axis];let captureFrame=null;const captureClamp=(v,a,b)=>Math.max(a,Math.min(b,v));const captureValue=(id,f=0,a=-1,b=1)=>captureClamp(captureFrame?.[id]??f,a,b);`,c);
 const template=fs.readFileSync(path.join(root,'runtime/index.template.html'),'utf8');
 for(const name of ['mul','around','evalMotion','groupMatrix','transformOwner','partMatrix']){
  const line=template.split('\n').find(l=>l.startsWith('function '+name+'('));vm.runInContext(line,c);
 }
 const capture=fs.readFileSync(path.join(root,'runtime/capture_player.js'),'utf8');
 vm.runInContext(capture.slice(capture.indexOf('function captureHas('),capture.indexOf('function captureTime(')),c);
 vm.runInContext(capture.slice(capture.indexOf('function captureSide('),capture.indexOf('function captureEyeOpen(')),c);
 vm.runInContext(capture.slice(capture.indexOf('function captureTransform('),capture.indexOf('function initCapturePlayer(')),c);
 vm.runInContext(headSource||fs.readFileSync(path.join(root,'runtime/head_pose.js'),'utf8'),c);
 return c;
}
module.exports={geometryContext};
if(require.main===module){
 const project=JSON.parse(fs.readFileSync(process.argv[2]||path.join(root,'rig.project.json'))),source=process.argv[3]?fs.readFileSync(process.argv[3],'utf8'):undefined,c=geometryContext(project,source);
 const poses=vm.runInContext(`(()=>{
  const sampler=neckSwayAngles,result={};
  for(const [name,[x,y]] of Object.entries(HEAD_DIRECTIONS)){
   neckSwayAngles=()=>({yaw:x*PROJECT.neck_sway.yaw_extent,pitch:y*PROJECT.neck_sway.pitch_extent,roll:0});beginHeadFrame(0);
   const master=neckMasterMesh(0,0),parts={};
   for(const p of Object.values(PROJECT.parts)){
    const owner=transformOwner(p),head=PROJECT.neck_sway.part_ids.includes(p.name),eye=owner.role==='eye'&&PROJECT.neck_sway.layout_mode!=='coordinated-25-v1';
    const setting=headPoseActive(p)?currentHeadSetting(p):null,eyeMatrix=head&&eye?neckEyeMatrix(owner,0,0,master):null;
    const columns=head?16:1,rows=head?16:1,src=[],dest=[];
    for(let r=0;r<=rows;r++)for(let col=0;col<=columns;col++){
     const point=[p.x+p.w*col/columns,p.y+p.h*r/rows];src.push([point[0]-p.x,point[1]-p.y]);
     let q=setting?headMapPoint(p,point,setting):point;
     if(head&&eye)q=[eyeMatrix[0]*q[0]+eyeMatrix[2]*q[1]+eyeMatrix[4],eyeMatrix[1]*q[0]+eyeMatrix[3]*q[1]+eyeMatrix[5]];
     else if(head)q=mapNeckMasterPoint(q,master);
     dest.push(q);
    }
    const triangles=[];for(let r=0;r<rows;r++)for(let col=0;col<columns;col++){const a=r*(columns+1)+col,b=a+1,d=a+columns+1,e=d+1;triangles.push([a,b,e],[a,e,d])}
    parts[p.name]={src,dest,triangles};
   }
   result[name]={yaw:x*PROJECT.neck_sway.yaw_extent,pitch:y*PROJECT.neck_sway.pitch_extent,parts,neckFill:typeof neckFillGeometry==='function'?neckFillGeometry(0,0):null};
  }
  neckSwayAngles=sampler;return result;
 })()`,c);
 process.stdout.write(JSON.stringify(poses));
}
