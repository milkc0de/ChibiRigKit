// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {installCaptureInputs} from './runtime-fixture.mjs';
const head=fs.readFileSync(new URL('../template/workspace/runtime/head_pose.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../template/workspace/runtime/index.template.html',import.meta.url),'utf8');
function fixture(){
  const controls={headEdit:{checked:false},headRandom:{checked:true},headCircle:{checked:false},duration:{value:5}};
  const fields={gazeX:{value:0},gazeY:{value:0}},cells=[];let rigid=0;
  const context=vm.createContext({PROJECT:{},crypto:{getRandomValues:a=>a},controls,$:id=>fields[id],structuredClone,drawRigid:()=>rigid++,drawEyeTriangle:(_ctx,_im,source,dest)=>cells.push({source,dest}),ctx:{}});
  installCaptureInputs(context,controls);
  vm.runInContext(head,context);
  vm.runInContext(html.slice(html.indexOf('function drawStripMesh('),html.indexOf('function drawSoftStrip(')),context);
  return {context,controls,fields,cells,rigid:()=>rigid,angle:v=>vm.runInContext(`headAngle=${JSON.stringify(v)}`,context)};
}
test('automatic gaze moves both pupils and respects manual offsets, editing, and eye-specific limits',()=>{
  const f=fixture(),eye={w:180,h:150,mesh:{gaze_x_ratio:.055,gaze_y_ratio:.045}};
  f.angle([-.8,.2]);const left=f.context.irisGazeOffset(eye);
  f.angle([.8,-.2]);const right=f.context.irisGazeOffset(eye);
  assert.ok(right[0]-left[0]>14);assert.ok(left[1]>0&&right[1]<0);
  f.fields.gazeX.value=1;assert.equal(f.context.irisGazeOffset(eye)[0],180*.055);
  f.controls.headEdit.checked=true;f.fields.gazeX.value=0;
  assert.deepEqual([...f.context.irisGazeOffset(eye)],[0,0]);
  f.controls.headEdit.checked=false;f.controls.headRandom.checked=false;
  assert.deepEqual([...f.context.irisGazeOffset(eye)],[0,0]);
});
test('zero deformation draws once instead of sampling fractional strip boundaries',()=>{
  const f=fixture(),p={w:173,h:251,x:10,y:20,mesh:{slices:8,amp_px:0,squash_pct:0}};
  f.context.drawSoftBody({},p,1.25,1);f.context.drawBendVertical({},p,1.25,1);
  assert.equal(f.rigid(),2);assert.equal(f.cells.length,0);
});
test('deformed strip triangles share exactly the same boundary vertices',()=>{
  for(const vertical of [false,true]){
    const f=fixture(),p={w:173,h:251,x:10,y:20};
    f.context.drawStripMesh({},p,8,vertical,(x,y,u)=>[x+Math.sin(u)*4,y+Math.cos(u)*2],{});
    assert.equal(f.cells.length,16);
    for(let i=0;i<7;i++){
      const previous=f.cells[i*2],next=f.cells[(i+1)*2];
      assert.deepEqual([...previous.dest[1]],[...next.dest[0]]);
      assert.deepEqual([...previous.dest[2]],[...f.cells[(i+1)*2+1].dest[2]]);
    }
  }
});

test('face amount scales displacement around the authored center without moving its baseline',()=>{
  const f=fixture(),p={name:'face'},vertices=[[1,2],[1,2],[1,2],[1,2]];
  f.context.PROJECT.head_pose={columns:1,rows:1,poses:{center:{parts:{face:{x:4,y:7,rotation:2,scale_x:1,scale_y:1,vertices}}}}};
  const pose={x:6,y:10,rotation:3,scale_x:.98,scale_y:1.02,vertices:vertices.map(v=>[v[0]+2,v[1]-1])};
  const stopped=f.context.amplifiedHeadSetting(p,pose,0),large=f.context.amplifiedHeadSetting(p,pose,3);
  assert.equal(stopped.x,4);assert.equal(stopped.y,7);assert.equal(stopped.rotation,2);assert.deepEqual([...stopped.vertices[0]],[1,2]);
  assert.equal(large.x,10);assert.equal(large.y,16);assert.equal(large.rotation,5);assert.deepEqual([...large.vertices[0]],[7,-1]);
});
test('pupil amount can stop or triple automatic gaze independently of face amount',()=>{
  const f=fixture(),eye={w:180,h:150,mesh:{gaze_x_ratio:.055,gaze_y_ratio:.045}};
  f.controls.gazeAmount={value:1};f.controls.headAmount={value:0};f.angle([.5,.2]);
  const normal=f.context.irisGazeOffset(eye);
  f.controls.gazeAmount.value=3;const large=f.context.irisGazeOffset(eye);
  assert.ok(Math.abs(large[0]-normal[0]*3)<1e-10);assert.ok(Math.abs(large[1]-normal[1]*3)<1e-10);
  f.controls.gazeAmount.value=0;assert.deepEqual([...f.context.irisGazeOffset(eye)],[0,0]);
  f.fields.gazeX.value=.5;assert.equal(f.context.irisGazeOffset(eye)[0],.5*180*.055);
});
