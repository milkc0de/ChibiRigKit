// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
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

test('permission expansion is refused while normal local work keeps workspace-write',async()=>{
  const {approvalResponse}=await import('../scripts/codex-app-server.mjs');
  assert.deepEqual(approvalResponse('item/commandExecution/requestApproval'),{decision:'decline'});
  assert.deepEqual(approvalResponse('item/fileChange/requestApproval'),{decision:'decline'});
  assert.deepEqual(approvalResponse('item/permissions/requestApproval'),{permissions:{},scope:'turn'});
  assert.equal(approvalResponse('unknown/requestApproval'),null);
  const f=fixture(),pending=f.server.runTurn(f.options);await Promise.resolve();
  assert.deepEqual(f.requests[0].params.sandboxPolicy,{type:'workspaceWrite',writableRoots:[f.options.cwd],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true});
  f.emit('turn/completed',f.event({turn:{id:'turn-1',status:'completed'}}));await pending;
});
test('remote transport must be encrypted and URL credentials are refused',async()=>{
  const {validateAppServerURL:check}=await import('../scripts/codex-app-server.mjs');
  for(const host of ['localhost','127.0.0.1','[::1]'])assert.equal(check(`ws://${host}:4500`),`ws://${host}:4500/`);
  assert.equal(check('wss://rig.example/path'),'wss://rig.example/path');
  for(const url of ['ws://rig.example','ws://localhost.attacker.example','ws://192.168.1.2:4500','wss://user:password@rig.example','https://rig.example'])assert.throws(()=>check(url));
});

test('wire approval requests receive no session grant, including unrelated threads',async()=>{
  const {WebSocketServer}=await import('ws');
  const wss=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>wss.once('listening',r));
  const replies=[],server=new CodexAppServer({url:`ws://127.0.0.1:${wss.address().port}`});
  let resolve;const done=new Promise(r=>resolve=r);
  wss.on('connection',ws=>ws.on('message',b=>{const m=JSON.parse(b);if(m.method==='initialize')ws.send(JSON.stringify({id:m.id,result:{}}));if(m.method==='initialized')for(const [id,method] of [[900,'item/commandExecution/requestApproval'],[901,'item/permissions/requestApproval']])ws.send(JSON.stringify({id,method,params:{threadId:'unrelated',turnId:'unrelated',permissions:{network:{enabled:true}}}}));if(m.id>=900){replies.push(m);if(replies.length===2)resolve()}}));
  try{await server.connect();await done;assert.deepEqual(replies.map(x=>x.result),[{decision:'decline'},{permissions:{},scope:'turn'}])}
  finally{server.close();await new Promise(r=>wss.close(r))}
});
