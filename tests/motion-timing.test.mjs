// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {installCaptureInputs} from './runtime-fixture.mjs';
const root=new URL('../template/workspace/runtime/',import.meta.url);
const html=fs.readFileSync(new URL('index.template.html',root),'utf8');
const head=fs.readFileSync(new URL('head_pose.js',root),'utf8');
function fixture(){
  const controls={duration:{value:4},motionSpeed:{value:1},motionIntensity:{value:1},autoBlink:{checked:true},headEdit:{checked:false},headRandom:{checked:true},headCircle:{checked:false},neckSway:{checked:true},neckYaw:{value:12},neckPitch:{value:8},neckAmount:{value:6}};
  const calls=[];
  const target=Object.fromEntries(['save','translate','scale','drawImage','restore'].map(k=>[k,(...args)=>calls.push([k,...args])]));
  const c=vm.createContext({PROJECT:{head_pose:{}},controls,crypto:{getRandomValues:a=>a},structuredClone,$:()=>({}),ctx:target,drawEyeTriangle:(_ctx,_im,src,dest)=>calls.push(dest)});
  installCaptureInputs(c,controls);
  vm.runInContext(html.slice(html.indexOf('function mul('),html.indexOf('function expressionValue(')),c);
  vm.runInContext(html.slice(html.indexOf('function drawStripMesh('),html.indexOf('function drawPart(')),c);
  vm.runInContext(head,c);
  vm.runInContext('headRandomSeed=12345',c);
  const part={x:0,y:0,w:60,h:90,mesh:{amp_px:3,squash_pct:2},motion:{rot_deg:8,x_px:2,y_px:3,scale_x_pct:2,scale_y_pct:1,phase:.2,freq:1.3}};
  function sample(t){
    calls.length=0;
    const speed=Number(controls.motionSpeed.value);
    c.drawBendVertical({},part,t*speed,1);c.drawSoftBody({},part,t*speed,1);c.drawSoftStrip({},part,t*speed,1);
    c.beginHeadFrame(t);
    const angle=vm.runInContext('headAngle',c);
    return JSON.parse(JSON.stringify({motion:c.evalMotion(part,t),blink:c.blinkPulse(t),neck:c.neckSwayAngles(t,1),angle,calls}));
  }
  return {controls,sample};
}
test('1 to 60 second recording lengths leave body, meshes, blink, face and neck trajectories unchanged',()=>{
  const f=fixture();
  for(const circle of [false,true]){
    f.controls.headRandom.checked=!circle;f.controls.headCircle.checked=circle;
    for(const t of [0,.7,1.44,1.6,3.32,7.5,12.3,35]){
      f.controls.duration.value=4;const expected=f.sample(t);
      for(const duration of [1,5,15,60]){f.controls.duration.value=duration;assert.deepEqual(f.sample(t),expected)}
    }
  }
});
test('motion speed still scales animation time independently of recording length',()=>{
  const f=fixture();
  for(const circle of [false,true]){
    f.controls.headRandom.checked=!circle;f.controls.headCircle.checked=circle;
    f.controls.motionSpeed.value=1;const normal=f.sample(1.44);
    f.controls.duration.value=60;f.controls.motionSpeed.value=2;
    assert.deepEqual(f.sample(.72),normal);assert.notDeepEqual(f.sample(1.44),normal);
  }
});
