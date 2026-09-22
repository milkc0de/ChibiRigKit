// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexAppServer,appServerLaunch} from '../scripts/codex-app-server.mjs';

function fixture(){
  const server=new CodexAppServer(),requests=[];
  server.request=async(method,params)=>{requests.push({method,params});return {turn:{id:'turn-1'}}};
  const emit=(method,params)=>{for(const fn of [...server.listeners])fn({method,params})};
  const event=(extra={})=>({threadId:'thread-1',turnId:'turn-1',...extra});
  const options={threadId:'thread-1',model:'gpt-6-astra',cwd:process.cwd(),input:[]};
  return {server,requests,emit,event,options};
}

test('default survives 31 minutes, reports activity and ignores unrelated turns',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
  const f=fixture(),progress=[];
  const pending=f.server.runTurn({...f.options,onProgress:p=>progress.push(p)});
  await Promise.resolve();
  f.emit('item/started',f.event({item:{type:'commandExecution'}}));
  f.emit('turn/completed',{threadId:'other',turn:{id:'other',status:'completed'}});
  t.mock.timers.tick(31*60_000);
  assert.ok(progress.length>0);
  assert.equal(progress.at(-1).elapsedMs,31*60_000);
  assert.equal(progress.at(-1).lastItem,'commandExecution');
  f.emit('item/completed',f.event({item:{type:'agentMessage',text:'Saved the rig'}}));
  f.emit('turn/completed',f.event({turn:{id:'turn-1',status:'completed'}}));
  assert.equal((await pending).finalText,'Saved the rig');
  assert.equal(f.server.listeners.length,0);
  assert.equal(f.requests.length,1);
});

test('explicit deadline interrupts the matching turn and includes recovery IDs',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
  const f=fixture();
  const pending=f.server.runTurn({...f.options,timeoutMs:60_000});
  const rejected=assert.rejects(pending,e=>e.threadId==='thread-1'&&e.turnId==='turn-1'&&/timeout/.test(e.message));
  await Promise.resolve();t.mock.timers.tick(60_000);await rejected;
  assert.deepEqual(f.requests.at(-1),{method:'turn/interrupt',params:{threadId:'thread-1',turnId:'turn-1'}});
  assert.equal(f.server.listeners.length,0);
});

test('transport failure rejects active turns promptly without a deadline',async()=>{
  const f=fixture(),pending=f.server.runTurn(f.options);
  const rejected=assert.rejects(pending,/connection lost/);
  await Promise.resolve();f.server.failTransport(new Error('connection lost'));await rejected;
  assert.equal(f.server.listeners.length,0);
});

test('completion arriving before the start response is retained',async()=>{
  const f=fixture();
  f.server.request=async()=>{
    f.server.messages.push({method:'item/completed',params:f.event({item:{type:'agentMessage',text:'Done'}})});
    f.server.messages.push({method:'turn/completed',params:f.event({turn:{id:'turn-1',status:'completed'}})});
    return {turn:{id:'turn-1'}};
  };
  assert.equal((await f.server.runTurn(f.options)).finalText,'Done');
  assert.equal(f.server.listeners.length,0);
});

test('failed turn remains a failure',async()=>{
  const f=fixture(),pending=f.server.runTurn(f.options);
  const rejected=assert.rejects(pending,/Codex turn failed/);
  await Promise.resolve();f.emit('turn/completed',f.event({turn:{id:'turn-1',status:'failed',error:{message:'failure'}}}));
  await rejected;
});

test('connection failure also rejects outstanding RPC requests',async()=>{
  const server=new CodexAppServer();server.sendRaw=()=>{};
  const pending=server.request('model/list');
  const rejected=assert.rejects(pending,/closed/);
  server.failTransport(new Error('closed'));await rejected;
  await assert.rejects(server.request('thread/start'),/closed/);
  assert.equal(server.pending.size,0);
});

test('Windows launch resolves npm cmd shims and quotes paths with spaces',()=>{
  const launch=appServerLaunch('C:\\Program Files\\Codex\\codex.cmd','win32');
  assert.deepEqual(launch.args,['/d','/s','/c','""C:\\Program Files\\Codex\\codex.cmd" app-server"']);
  assert.equal(launch.options.windowsVerbatimArguments,true);
  assert.throws(()=>appServerLaunch('bad"name','win32'));
  assert.deepEqual(appServerLaunch('/usr/local/bin/codex','darwin').args,['app-server']);
});
