#!/usr/bin/env node
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),project=JSON.parse(fs.readFileSync(path.join(root,'rig.project.json')));
const meta=JSON.parse(fs.readFileSync(path.join(root,'work/mesh25/pixels/manifest.json'))),images={};
for(const [file,m] of Object.entries(meta))images[file]={width:m.width,height:m.height,data:new Uint8ClampedArray(fs.readFileSync(path.join(root,m.path)))};
const original=Object.fromEntries(Object.entries(images).map(([k,v])=>[k,v.data.slice()]));
function canvas(){const c={width:0,height:0,data:null};c.getContext=()=>({drawImage(im){c.data=im.data.slice()},getImageData(){return {data:c.data.slice()}},putImageData(frame){c.data=frame.data.slice()}});return c}
const context=vm.createContext({PROJECT:project,images,document:{createElement:canvas}});
vm.runInContext(fs.readFileSync(path.join(root,'runtime/expression_underpaint.js'),'utf8'),context);
const count=vm.runInContext('prepareBrowUnderpaint()',context);assert.ok(count>0);
const out=path.join(root,'work/mesh25/underpaint');fs.mkdirSync(out,{recursive:true});let changed=0,alphaChanges=0;
for(const [file,m] of Object.entries(meta)){
 const old=original[file],now=images[file].data;for(let i=0;i<old.length;i++){if(i%4===3){if(old[i]!==now[i])alphaChanges++}else if(old[i]!==now[i])changed++}
 if(m.variant==='part')fs.writeFileSync(path.join(out,m.part+'.rgba'),now);
}
assert.equal(alphaChanges,0);assert.ok(changed>0);
// Exercise actual mouth and eyebrow rendering functions with a drawing recorder.
const {geometryContext}=require('./pose_geometry.cjs'),c=geometryContext(project);const run=s=>vm.runInContext(s,c);
const clipContext={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(root,'runtime/motion_clip.js'),'utf8'),clipContext);
c.MotionClip=clipContext.module.exports;c.source=JSON.parse(fs.readFileSync(path.join(root,'../../tmp/motion.chibimotion.json')));
const capture=fs.readFileSync(path.join(root,'runtime/capture_player.js'),'utf8');run(capture.slice(capture.indexOf('function captureMouthValue('),capture.indexOf('function initCapturePlayer(')));
const template=fs.readFileSync(path.join(root,'runtime/index.template.html'),'utf8');
run(template.slice(template.indexOf('function drawMouthOpenClose('),template.indexOf('// Adjacent cells')));
run(template.slice(template.indexOf('function drawCapturedBrow('),template.indexOf('function drawPart(')));
run(`let lastTransform=null,browShape=null;function drawRigid(){};function drawStripMesh(im,p,s,v,deform,target){browShape=[0,.5,1].map(u=>deform(p.w*u,0,u))};
const target={save(){},restore(){},translate(){},transform(...m){lastTransform=m},drawImage(){}};
$('captureMouthGain').value=1;$('captureBrowGain').value=2;`);
const expressions=run(`(()=>{
 const clip=MotionClip.parse(source),samples=[];for(let t=0;t<clip.duration;t+=.1){captureFrame=MotionClip.sample(clip,t);samples.push({t,mouth:captureMouthValue(),brow:captureTransform(PROJECT.parts.brow_left,1).y})}
 const low=samples.reduce((a,b)=>a.mouth<b.mouth?a:b),high=samples.reduce((a,b)=>a.mouth>b.mouth?a:b);
 const mouthMatrices=[low,high].map(s=>{captureFrame=MotionClip.sample(clip,s.t);drawMouthOpenClose({},PROJECT.parts.mouth_open,captureMouthValue(),target);return lastTransform});
 const browSamples=[samples.reduce((a,b)=>a.brow<b.brow?a:b),samples.reduce((a,b)=>a.brow>b.brow?a:b)];
 const browShapes=browSamples.map(s=>{captureFrame=MotionClip.sample(clip,s.t);drawCapturedBrow({},PROJECT.parts.brow_left,target);return browShape});
 return {mouthRange:[low,high],mouthMatrices,browRange:browSamples,browShapes};
})()`);
assert.notDeepEqual(expressions.mouthMatrices[0],expressions.mouthMatrices[1]);assert.notDeepEqual(expressions.browShapes[0],expressions.browShapes[1]);
assert.ok(Math.abs(expressions.browRange[0].brow-expressions.browRange[1].brow)>25);
const report={underpaint:{layers:count,changedColorChannels:changed,alphaChanges,sourceFilesUnmodified:true},...expressions};fs.writeFileSync(path.join(root,'work/mesh25/expression-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
