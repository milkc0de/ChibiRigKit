// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../template/workspace/runtime/background.js',import.meta.url),'utf8');
function fixture(){
  const fields=Object.fromEntries(['backgroundMode','backgroundColor','backgroundFit','backgroundStatus','backgroundFile','resetBackground'].map(k=>[k,{value:''}]));
  const storage=new Map(),draws=[],PROJECT={name:'test',parts:{face:{name:'face',role:'base',kind:'static'}}};
  const controls={showBaseOnly:{checked:false}};
  const context=vm.createContext({PROJECT,canvas:{width:200,height:300},controls,$:id=>fields[id],ctx:{save(){},restore(){},fillRect(...args){draws.push(['fill',...args])},drawImage(...args){draws.push(['image',...args])}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},loadImage:async()=>({width:100,height:100})});
  vm.runInContext(source,context);
  return {context,fields,storage,draws,controls,PROJECT,state:()=>JSON.parse(vm.runInContext('JSON.stringify(backgroundState)',context)),set:changes=>context.setBackground({...JSON.parse(vm.runInContext('JSON.stringify(backgroundDefaults)',context)),...changes})};
}
test('transparent skips only dedicated backgrounds and leaves static character layers intact',()=>{
  const f=fixture();f.set({mode:'transparent'});f.context.drawBackground();
  assert.equal(f.context.customBackgroundActive(),true);assert.equal(f.draws.length,0);
  assert.equal(f.context.isBackgroundPart({name:'background',kind:'static',role:'base'}),true);
  assert.equal(f.context.isBackgroundPart({name:'margin',kind:'normal',role:'background'}),true);
  assert.equal(f.context.isBackgroundPart(f.PROJECT.parts.face),false);
  f.controls.showBaseOnly.checked=true;assert.equal(f.context.customBackgroundActive(),false);
});
test('image fit preserves aspect ratio for cover and contain',()=>{
  const f=fixture();assert.deepEqual([...f.context.backgroundRect(400,200,200,300,'cover')],[-200,0,600,300]);
  assert.deepEqual([...f.context.backgroundRect(400,200,200,300,'contain')],[0,100,200,100]);
});
test('solid color fills the canvas without changing rig data',()=>{
  const f=fixture(),before=JSON.stringify(f.PROJECT);f.set({mode:'color',color:'#335577'});f.context.drawBackground();
  assert.deepEqual(f.draws,[['fill',0,0,200,300]]);assert.equal(JSON.stringify(f.PROJECT),before);
});
test('invalid image or persisted remote URL leaves the selected background unchanged',()=>{
  const f=fixture();f.set({mode:'transparent'});const before=f.state();
  for(const image of ['https://example.com/image.png','data:image/svg+xml;base64,PHN2Zz4=',null])assert.throws(()=>f.set({mode:'image',image}));
  assert.deepEqual(f.state(),before);
});
test('background restores across initialization and reset removes only its storage key',async()=>{
  const f=fixture();f.set({mode:'transparent'});f.storage.set('unrelated-face-settings','keep');
  await f.context.initBackground();assert.equal(f.fields.backgroundMode.value,'transparent');
  f.fields.resetBackground.onclick();assert.equal(f.fields.backgroundMode.value,'original');assert.equal(f.storage.size,1);assert.equal(f.storage.get('unrelated-face-settings'),'keep');
});
test('a late persisted image load cannot override a newer transparent selection',async()=>{
  const f=fixture();f.set({mode:'image',image:'data:image/png;base64,AA==',name:'test.png'});
  let release;f.context.loadImage=()=>new Promise(resolve=>{release=resolve});
  const restoring=f.context.initBackground();
  f.fields.backgroundMode.value='transparent';f.fields.backgroundMode.onchange();
  release({width:100,height:100});await restoring;
  assert.equal(f.state().mode,'transparent');assert.equal(f.fields.backgroundMode.value,'transparent');
});
