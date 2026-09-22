// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const head=fs.readFileSync(new URL('../template/workspace/runtime/head_pose.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../template/workspace/runtime/index.template.html',import.meta.url),'utf8');
function fixture(){
  const PROJECT=JSON.parse(fs.readFileSync(new URL('../characters/milkc0de/rig.project.json',import.meta.url)));
  const controls={headRandom:{checked:false},headCircle:{checked:false},neckSway:{checked:true},neckAmount:{value:12},neckYaw:{value:12},neckPitch:{value:8},headEdit:{checked:false},duration:{value:5},motionSpeed:{value:1}};
  const c=vm.createContext({PROJECT,controls,structuredClone,crypto:{getRandomValues:a=>a}});
  vm.runInContext(html.slice(html.indexOf('function mul('),html.indexOf('function smoothstep(')),c);
  vm.runInContext(html.slice(html.indexOf('function transformOwner('),html.indexOf('function drawRigid(')),c);
  vm.runInContext(head,c);vm.runInContext('headRandomSeed=12345',c);
  return {c,PROJECT,controls};
}
function close(a,b){assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,`${a} != ${b}`))}
test('all 21 head layers including blink endpoints share one neck transform; body stays unchanged',()=>{
  const {c,PROJECT,controls}=fixture(),t=12;
  assert.equal(PROJECT.neck_sway.part_ids.length,21);
  const expected=c.neckSwayMatrix(PROJECT.parts.face_skin,t,1);
  assert.ok(Math.abs(expected[1])>.001);
  for(const p of Object.values(PROJECT.parts)){
    controls.neckSway.checked=false;const before=c.partMatrix(p,t,1);
    controls.neckSway.checked=true;const after=c.partMatrix(p,t,1);
    if(PROJECT.neck_sway.part_ids.includes(p.name)){close(c.neckSwayMatrix(p,t,1),expected);close(after,c.mul(expected,before))}
    else close(after,before);
  }
  close(c.partMatrix(PROJECT.parts.eye_left_closed,t,1),c.partMatrix(PROJECT.parts.eye_left_sclera,t,1));
});
test('animated neck anchor is stationary under the added rotation',()=>{
  const {c,PROJECT}=fixture(),n=PROJECT.neck_sway,t=12;
  const g=c.groupMatrix(PROJECT.parts[n.anchor_part].parent,t,1),v=n.pivot;
  const x=g[0]*v.x+g[2]*v.y+g[4],y=g[1]*v.x+g[3]*v.y+g[5],m=c.neckSwayMatrix(PROJECT.parts.face_skin,t,1);
  close([m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]],[x,y]);
});
test('neck sampling is smooth, bounded, repeatable and disabled during editing or at zero amount',()=>{
  const {c,controls,PROJECT}=fixture();let previous=0;const values=[];
  for(let i=0;i<600;i++){
    const value=c.neckSwayAngle(i/20,1);assert.ok(Math.abs(value)<=12);assert.ok(Math.abs(value-previous)<.9);assert.equal(value,c.neckSwayAngle(i/20,1));values.push(value);previous=value;
  }
  assert.ok(Math.max(...values)-Math.min(...values)>8);
  controls.neckAmount.value=0;assert.ok(c.neckSwayAngle(12,1)===0);
  controls.neckAmount.value=12;controls.headEdit.checked=true;assert.ok(c.neckSwayAngle(12,1)===0);
  controls.headEdit.checked=false;assert.ok(c.neckSwayAngle(12,0)===0);
  delete PROJECT.neck_sway;close(c.neckSwayMatrix(PROJECT.parts.face_skin,12,1),[1,0,0,1,0,0]);
});

test('yaw pitch and roll each deform the whole head around the same neck, without folding',()=>{
  const {c}=fixture(),pivot={x:520,y:620};
  for(const [axis,max] of [['yaw',30],['pitch',20],['roll',15]])for(const value of [-max,max]){
    const angles={yaw:0,pitch:0,roll:0,[axis]:value},m=c.neckProjectionMatrix(pivot,angles);
    assert.ok(m[0]*m[3]-m[1]*m[2]>.5);
    close([m[0]*pivot.x+m[2]*pivot.y+m[4],m[1]*pivot.x+m[3]*pivot.y+m[5]],[pivot.x,pivot.y]);
    assert.notDeepEqual([...m],[1,0,0,1,0,0]);
  }
});

test('shared parent lattice has nine nonfolded reference shapes and a pinned neck vertex',()=>{
  const {c,PROJECT}=fixture(),n=PROJECT.neck_sway;
  assert.ok(n.mesh.points.length>300);assert.ok(n.mesh.triangles.length>600);
  n.mesh.points.forEach((point,i)=>close(n.poses.center.vertices[i],point));
  const pinned=n.mesh.points.findIndex(p=>p[0]===n.pivot.x&&p[1]===n.pivot.y);assert.ok(pinned>=0);
  for(const pose of Object.values(n.poses)){
    assert.equal(pose.vertices.length,n.mesh.points.length);close(pose.vertices[pinned],[n.pivot.x,n.pivot.y]);
    for(const [i,j,k] of n.mesh.triangles){const [a,b,d]=[i,j,k].map(x=>pose.vertices[x]);assert.ok((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0])>0)}
  }
  for(const yaw of [-30,-15,0,15,30])for(const pitch of [-20,-10,0,10,20]){
    c.neckSwayAngles=()=>({yaw,pitch,roll:6});vm.runInContext('neckMasterFrame=null',c);
    const mesh=c.neckMasterMesh(0,1);for(const [i,j,k] of mesh.triangles){const [a,b,d]=[i,j,k].map(x=>mesh.dest[x]);assert.ok((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0])>0)}
  }
});

test('diagonal eyes preserve their original size while their centers follow the parent',()=>{
  const {c,PROJECT}=fixture(),n=PROJECT.neck_sway;
  for(const yaw of [-30,30])for(const pitch of [-20,20]){
    c.neckSwayAngles=()=>({yaw,pitch,roll:0});vm.runInContext('neckMasterFrame=null',c);const mesh=c.neckMasterMesh(0,1);
    for(const name of ['eye_left_sclera','eye_right_sclera']){
      const m=c.neckEyeMatrix(PROJECT.parts[name],0,1,mesh);assert.ok(Math.abs(Math.hypot(m[0],m[1])-1)<1e-9);assert.ok(Math.abs(Math.hypot(m[2],m[3])-1)<1e-9);
    }
  }
  for(const direction of ['up_left','up_right','down_left','down_right'])for(const name of ['eye_left_sclera','eye_right_sclera']){
    assert.equal(n.poses[direction].parts[name].scale_x,1);assert.equal(n.poses[direction].parts[name].scale_y,1);
  }
});
