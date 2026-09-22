// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),MotionClip=require('../template/workspace/runtime/motion_clip.js');
const bundle=fs.readFileSync(new URL('../template/workspace/runtime/bundle.js',import.meta.url),'utf8');
function snapshot(nodes){return JSON.parse(nodes.get('body').children.find(n=>n.id==='bundleSnapshot').textContent)}
function fixture(include=false){
 const nodes=new Map();
 const node=(id,text='')=>({id,textContent:text,children:[],attrs:{},replaceChildren(...c){this.children=c;this.textContent=''},append(n){this.children.push(n)},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},remove(){nodes.delete(id)}});
 for(const id of ['projectData','headPart','headVertex','partSelect','recordCancel','record','bundle','recordStatus','bundleStatus','recordProgress','body','trackingStatus','takeStatus','captureStatus','backgroundStatus','headStatus','motionIOStatus','loadStatus','cameraPreview','cameraVideo','audioMeter','bundleIncludeMotion'])nodes.set(id,node(id,'PRIVATE_STATUS'));
 nodes.set('cameraDevice',node('cameraDevice','PRIVATE_CAMERA_NAME_AND_ID'));nodes.set('microphoneDevice',node('microphoneDevice','PRIVATE_MIC_NAME_AND_ID'));
 const page={querySelector:s=>nodes.get(s.replace('#','')),querySelectorAll:()=>[],get outerHTML(){return [...nodes].map(([id,n])=>`<div id="${id}">${n.textContent}${n.children.map(x=>x.textContent).join('')}</div>`).join('')}};
 const source={format:'ChibiRigMotion',version:1,timeUnit:'seconds',duration:1,loop:false,channels:['mouthOpen'],frames:[[0,0],[1,.5]],metadata:{createdAt:'PRIVATE_DATE',name:'PRIVATE_TAKE'},unknown:'PRIVATE_EXTRA'};
 const c=vm.createContext({MotionClip,document:{documentElement:{cloneNode:()=>page},createElement:()=>node(''),getElementById:()=>({textContent:'MIT'})},collectMotionProject:()=>({parts:{}}),collectMotionPreset:()=>({}),backgroundState:{mode:'image',image:'data:image/png;base64,AQID',name:'PRIVATE_BACKGROUND_NAME'},headRandomSeed:1,outputState:{crop:{}},captureMotion:{source,name:'PRIVATE_FILENAME'},$:id=>({checked:id==='bundleIncludeMotion'?include:false,value:'#ffffff'}),Blob,TextEncoder,atob});
 vm.runInContext(bundle,c);return {c,nodes};
}
test('export removes device data, transient messages, filenames and capture by default',()=>{
 const {c,nodes}=fixture();const files=c.bundleFiles();
 assert.deepEqual(Object.keys(files).sort(),['LICENSE.txt','index.html']);
 assert.equal(snapshot(nodes).capture,null);
 // Mock structural labels are ignored; actual private source data must be absent.
 for(const s of ['PRIVATE_CAMERA','PRIVATE_MIC','PRIVATE_TAKE','PRIVATE_DATE','PRIVATE_EXTRA','PRIVATE_FILENAME','PRIVATE_BACKGROUND_NAME'])assert.ok(!JSON.stringify(files).includes(s),s);
 assert.equal(nodes.get('trackingStatus').textContent.includes('この端末'),true);
 for(const id of ['takeStatus','captureStatus','backgroundStatus','headStatus','motionIOStatus','loadStatus'])assert.equal(nodes.get(id).textContent,'');
 assert.equal(nodes.get('cameraPreview').hidden,true);
 assert.equal(files['LICENSE.txt'],'MIT');
});
test('explicit capture inclusion retains playback numbers but drops all metadata',()=>{
 const {c,nodes}=fixture(true),files=c.bundleFiles(),data=snapshot(nodes).capture.source;
 assert.deepEqual(Object.keys(files).sort(),['LICENSE.txt','index.html']);
 assert.equal(data.metadata,undefined);assert.equal(data.unknown,undefined);assert.deepEqual(data.frames,[[0,0],[1,.5]]);
 for(const s of ['PRIVATE_CAMERA','PRIVATE_MIC','PRIVATE_DATE','PRIVATE_TAKE','PRIVATE_EXTRA','PRIVATE_FILENAME','PRIVATE_BACKGROUND_NAME'])assert.ok(!JSON.stringify(files).includes(s),s);
 assert.doesNotThrow(()=>MotionClip.parse(data));
});
test('inactive background images are not leaked into exports',()=>{
 const {c,nodes}=fixture();c.backgroundState.mode='color';c.bundleFiles();assert.equal(snapshot(nodes).background.image,null);
});
