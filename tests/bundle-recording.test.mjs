// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const dir=new URL('../template/workspace/runtime/',import.meta.url),bundle=fs.readFileSync(new URL('bundle.js',dir),'utf8'),record=fs.readFileSync(new URL('recording.js',dir),'utf8');
test('ZIP opens in a standard reader with UTF-8 paths, binary bytes and valid CRC',async()=>{
  const c=vm.createContext({TextEncoder,Blob,$:()=>({})});vm.runInContext(bundle,c);
  const blob=c.createZip({'index.html':'<p>完成品</p>','assets/日本語.png':Uint8Array.from([0,255,17,23])});
  const bytes=Buffer.from(await blob.arrayBuffer());
  const result=spawnSync('python3',['-c',`import sys,io,zipfile
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
assert z.read('index.html').decode()=='<p>完成品</p>'
assert z.read('assets/日本語.png')==bytes([0,255,17,23])
`],{input:bytes});assert.equal(result.status,0,result.stderr.toString());
  assert.throws(()=>c.createZip({'../escape':'x'}));
});
function recorderFixture(fail=false){
  const fields={record:{disabled:false},recordCancel:{hidden:true},recordStatus:{},recordProgress:{},duration:{value:60,disabled:false}},timeouts=[],intervals=[],downloads=[],tracks=[];
  let now=1000,instance;
  class Recorder{static isTypeSupported(){return true}constructor(){if(fail)throw Error('unsupported');instance=this;this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['video'])});this.onstop()}}
  const c=vm.createContext({window:{MediaRecorder:Recorder},MediaRecorder:Recorder,canvas:{captureStream:()=>({getTracks:()=>[{stop:()=>tracks.push('stopped')}]})},document:{querySelectorAll:()=>[fields.record,fields.duration]},controls:{duration:fields.duration},$:id=>fields[id],performance:{now:()=>now},Blob,render:()=>{},downloadBlob:(b,n)=>downloads.push([b,n]),setTimeout:(fn,ms)=>{timeouts.push({fn,ms});return timeouts.length},setInterval:fn=>{intervals.push(fn);return 1},clearTimeout:()=>{},clearInterval:()=>{},running:false,start:0,pausedAt:3});vm.runInContext(record,c);
  return {c,fields,timeouts,intervals,downloads,tracks,setNow:v=>now=v};
}
test('recording uses exactly the selected 60 seconds, shows progress and restores controls',async()=>{
  const f=recorderFixture(),done=f.c.recordLoop();assert.equal(f.timeouts[0].ms,60000);assert.equal(f.fields.duration.disabled,true);
  f.setNow(13300);f.intervals[0]();assert.match(f.fields.recordStatus.textContent,/12.3 \/ 60.0/);
  f.timeouts[0].fn();await done;assert.match(f.fields.recordStatus.textContent,/60.0 \/ 60.0/);assert.equal(f.fields.duration.disabled,false);assert.equal(f.c.running,false);assert.equal(f.c.pausedAt,3);assert.equal(f.downloads.length,1);assert.equal(f.tracks.length,1);
});
test('recording failure releases tracks and controls, and does not download empty output',async()=>{
  const f=recorderFixture(true);await f.c.recordLoop();assert.match(f.fields.recordStatus.textContent,/録画できません/);assert.equal(f.fields.record.disabled,false);assert.equal(f.tracks.length,1);assert.equal(f.downloads.length,0);
});

test('cancel stops recording, restores playback and never saves the partial video',async()=>{
  const f=recorderFixture(),done=f.c.recordLoop();assert.equal(f.fields.recordCancel.hidden,false);assert.equal(f.fields.recordCancel.disabled,false);
  f.fields.recordCancel.onclick();await done;assert.equal(f.fields.recordCancel.hidden,true);assert.match(f.fields.recordStatus.textContent,/中止しました/);assert.equal(f.downloads.length,0);assert.equal(f.tracks.length,1);assert.equal(f.fields.duration.disabled,false);
});
