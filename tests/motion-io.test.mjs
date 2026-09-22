// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync(new URL('../template/workspace/runtime/project_io.js',import.meta.url),'utf8');
function fixture(){
  const part={name:'hair',file:'hair.png',sha256:'same-art',x:0,y:0,w:30,h:30,kind:'normal',role:'hair',motion:{rot_deg:1,freq:1}};
  const PROJECT={motion_layout_signature:'fixture-layout',version:2,canvas:{width:100,height:100},draw_order:['hair'],parts:{hair:part},groups:{body:{pivot:{x:50,y:80},motion:{rot_deg:.2}}},settings:{duration_seconds:4,motion_intensity:1,head_random:false}};
  const context=vm.createContext({PROJECT,initialSettings:structuredClone(PROJECT.settings),structuredClone});
  vm.runInContext(script,context);
  return {PROJECT,validate:data=>context.validateMotionProject(data)};
}
test('restores whole-project motion, groups and global settings from reordered JSON',()=>{
  const {PROJECT,validate}=fixture(),data=structuredClone(PROJECT);
  data.parts.hair.motion.rot_deg=3.25;data.groups.body.motion.rot_deg=.8;
  data.settings={motion_speed:1.5,motion_intensity:2,duration_seconds:8,auto_blink:false};
  data.canvas={height:100,width:100};
  const v=validate(data);
  assert.equal(v.parts.hair.rot_deg,3.25);assert.equal(v.groups.body.rot_deg,.8);
  assert.equal(v.settings.motion_speed,1.5);assert.equal(v.settings.auto_blink,false);
  assert.equal(PROJECT.parts.hair.motion.rot_deg,1);
});
test('legacy exports without UI settings remain readable',()=>{
  const {PROJECT,validate}=fixture();delete PROJECT.settings;
  const v=validate(PROJECT);assert.equal(v.settings.duration_seconds,4);
});
test('rejects mismatched art, topology and invalid motion before changing state',()=>{
  const {PROJECT,validate}=fixture(),before=JSON.stringify(PROJECT);
  for(const alter of [p=>p.parts.hair.sha256='other-art',p=>p.parts.extra=p.parts.hair,p=>p.parts.hair.motion.freq=0,p=>p.parts.hair.motion.x_px=NaN,p=>p.settings.motion_speed=0,p=>p.settings.auto_blink='false',p=>p.groups.body.pivot.x=30,p=>p.settings.blink={closed_eye_swap_start:1,closed_eye_swap_end:.8}]){
    const p=structuredClone(PROJECT);alter(p);assert.throws(()=>validate(p));assert.equal(JSON.stringify(PROJECT),before);
  }
});
test('rejects simultaneous automatic head modes',()=>{
  const {PROJECT,validate}=fixture();PROJECT.settings.head_random=true;PROJECT.settings.head_circle=true;
  assert.throws(()=>validate(PROJECT),/同時/);
});

test('character motion template expands without replacing images or layout',()=>{
  const {PROJECT,validate}=fixture();
  const compact={format:'chibirigkit.motion',version:1,layout_signature:PROJECT.motion_layout_signature,settings:{motion_speed:2},parts:{hair:{rot_deg:4}},groups:{body:{rot_deg:.6}}};
  const v=validate(compact);assert.equal(v.parts.hair.rot_deg,4);assert.equal(v.groups.body.rot_deg,.6);assert.equal(PROJECT.parts.hair.sha256,'same-art');
  compact.layout_signature='another-character';assert.throws(()=>validate(compact),/このキャラ/);
  compact.layout_signature=PROJECT.motion_layout_signature;compact.parts.extra={};assert.throws(()=>validate(compact),/構成/);
});

test('independent face and pupil amounts roundtrip and reject invalid values',()=>{
  const {PROJECT,validate}=fixture(),data=structuredClone(PROJECT);
  data.settings.head_motion_amount=3;data.settings.gaze_motion_amount=0;
  const v=validate(data);assert.equal(v.settings.head_motion_amount,3);assert.equal(v.settings.gaze_motion_amount,0);
  for(const key of ['head_motion_amount','gaze_motion_amount'])for(const invalid of [-1,4.01,NaN,'2']){
    const bad=structuredClone(data);bad.settings[key]=invalid;assert.throws(()=>validate(bad));
  }
});

test('neck controls roundtrip and validate bounds independently of face and pupils',()=>{
  const {PROJECT,validate}=fixture(),data=structuredClone(PROJECT);
  data.settings.neck_sway=true;data.settings.neck_sway_degrees=12;
  const result=validate(data);assert.equal(result.settings.neck_sway,true);assert.equal(result.settings.neck_sway_degrees,12);
  for(const v of [-1,15.1,NaN,'6']){data.settings.neck_sway_degrees=v;assert.throws(()=>validate(data))}
  data.settings.neck_sway_degrees=0;data.settings.neck_sway='true';assert.throws(()=>validate(data));
});

test('60 second recordings and three neck axes are accepted with strict limits',()=>{
  const {PROJECT,validate}=fixture(),data=structuredClone(PROJECT);
  Object.assign(data.settings,{duration_seconds:60,neck_yaw_degrees:30,neck_pitch_degrees:20,neck_sway_degrees:15});
  assert.equal(validate(data).settings.duration_seconds,60);
  for(const [key,limit] of [['duration_seconds',60],['neck_yaw_degrees',30],['neck_pitch_degrees',20]]){
    const bad=structuredClone(data);bad.settings[key]=limit+.1;assert.throws(()=>validate(bad));
  }
});
