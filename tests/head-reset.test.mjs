// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../template/workspace/runtime/head_pose.js',import.meta.url),'utf8');
function fixture(){
  const poses=Object.fromEntries(['center','left','right','up','down','up_left','up_right','down_left','down_right'].map(k=>[k,{status:'authored',parts:{eye:{x:k==='left'?-3:0,y:0}}}]));
  const PROJECT={head_pose:{layout_signature:'reset-fixture',poses},settings:{motion_intensity:1},parts:{eye:{motion:{rot_deg:0}}}};
  const initial=structuredClone(PROJECT.head_pose),store=new Map(),elements={gazeX:{value:.7},gazeY:{value:-.3},headStatus:{}};
  const context=vm.createContext({PROJECT,structuredClone,crypto:{getRandomValues:a=>a},localStorage:{setItem:(k,v)=>store.set(k,v)},$:id=>elements[id],controls:{neckSway:{checked:false},headEdit:{checked:false},headRandom:{checked:true},headCircle:{checked:false},headX:{value:0},headY:{value:0}},document:{querySelectorAll:()=>[]}});
  vm.runInContext(source,context);
  // Geometry validation has independent coverage; exercise real reset, selection and draft code here.
  vm.runInContext('validateHeadConfig=()=>true;syncHeadEditor=()=>{};',context);
  return {PROJECT,initial,store,elements,context,run:s=>vm.runInContext(s,context)};
}
test('direction reset discards a stale eye draft, preserves other directions and persists the result',()=>{
  const f=fixture();
  f.run("headDirection='left';headDraft={parts:{eye:{x:99}}};headDirty=true;PROJECT.head_pose.poses.left.parts.eye.x=55;PROJECT.head_pose.poses.right.parts.eye.x=42");
  f.context.resetHeadPoses(false);
  assert.deepEqual(f.PROJECT.head_pose.poses.left,f.initial.poses.left);
  assert.equal(f.PROJECT.head_pose.poses.right.parts.eye.x,42);
  assert.equal(f.run('headDraft.parts.eye.x'),-3);
  assert.equal(f.run('headDirty'),false);
  assert.equal(f.elements.gazeX.value,0);assert.equal(f.elements.gazeY.value,0);
  assert.equal(JSON.parse([...f.store.values()][0]).poses.left.parts.eye.x,-3);
  assert.equal(f.PROJECT.settings.motion_intensity,1);
});
test('all directions reset to embedded defaults after an import or saved edits',()=>{
  const f=fixture();
  f.run("PROJECT.head_pose=structuredClone(PROJECT.head_pose);for(const p of Object.values(PROJECT.head_pose.poses))p.parts.eye.x=75;headDirection='down';headDraft={parts:{eye:{x:99}}}");
  f.context.resetHeadPoses(true);
  assert.deepEqual(f.PROJECT.head_pose,f.initial);
  assert.equal(f.run('headDirection'),'center');
  assert.deepEqual(JSON.parse([...f.store.values()][0]),f.initial);
  f.PROJECT.head_pose.poses.center.parts.eye.x=19;
  f.context.resetHeadPoses(true);
  assert.equal(f.PROJECT.head_pose.poses.center.parts.eye.x,0);
});
test('storage failure still resets the displayed pose and reports that it was not saved',()=>{
  const f=fixture();f.run("localStorage.setItem=()=>{throw Error('quota')};PROJECT.head_pose.poses.center.parts.eye.x=19");
  f.context.resetHeadPoses(true);
  assert.deepEqual(f.PROJECT.head_pose,f.initial);
  assert.match(f.elements.headStatus.textContent,/保存できない/);
});
