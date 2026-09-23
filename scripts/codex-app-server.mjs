// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';

export function appServerLaunch(codexBin,platform=process.platform){
  if(platform!=='win32')return {command:codexBin,args:['app-server'],options:{}};
  if(/["%\r\n]/.test(codexBin))throw Error('Unsupported characters in Codex executable path');
  // npm installs a .cmd shim on Windows; cmd.exe must resolve and execute it.
  return {command:process.env.ComSpec||'cmd.exe',args:['/d','/s','/c',`""${codexBin}" app-server"`],options:{windowsVerbatimArguments:true}};
}

// Only loopback may use plaintext transport. Never put credentials in the URL.
export function validateAppServerURL(value){
  const url=new URL(value);
  if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password)throw Error('Use ws/wss without URL credentials');
  if(url.protocol==='ws:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Remote Codex app-server requires wss://');
  return url.href;
}
// Routine edits and local checks already run inside workspace-write. Approval
// requests expand that boundary; they must never silently escape the sandbox.
export function approvalResponse(method){
  if(method==='item/permissions/requestApproval')return {permissions:{},scope:'turn'};
  if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method))return {decision:'decline'};
  if(method==='mcpServer/elicitation/request')return {action:'decline',content:null};
  return null;
}

export class CodexAppServer {
  constructor({url=null,codexBin='codex',cwd=process.cwd()}={}){this.url=url;this.codexBin=codexBin;this.cwd=cwd;this.nextId=1;this.pending=new Map();this.listeners=[];this.messages=[];this.transportError=null;}
  async connect(){
    if(this.url){
      const url=validateAppServerURL(this.url);
      const {default:WebSocket}=await import('ws');
      await new Promise((resolve,reject)=>{const token=process.env.CODEX_APP_SERVER_TOKEN;this.ws=new WebSocket(url,token?{headers:{Authorization:`Bearer ${token}`}}:undefined);this.ws.once('open',resolve);this.ws.once('error',reject);this.ws.on('message',d=>this.#handle(String(d)));});
      this.sendRaw=o=>this.ws.send(JSON.stringify(o));
      this.ws.on('close',()=>this.failTransport(new Error('Codex app-server connection closed')));
      this.ws.on('error',e=>this.failTransport(e));
    }else{
      const launch=appServerLaunch(this.codexBin),temp=path.join(this.cwd,'work/agent-tmp');
      fs.mkdirSync(temp,{recursive:true});
      this.proc=spawn(launch.command,launch.args,{cwd:this.cwd,stdio:['pipe','pipe','inherit'],env:{...process.env,TMPDIR:temp,TMP:temp,TEMP:temp,CHIBIRIG_DIST_ROOT:path.join(this.cwd,'work/agent-output')},...launch.options});
      await new Promise((resolve,reject)=>{this.proc.once('spawn',resolve);this.proc.once('error',reject);});
      const rl=readline.createInterface({input:this.proc.stdout});rl.on('line',line=>this.#handle(line));
      this.sendRaw=o=>this.proc.stdin.write(JSON.stringify(o)+'\n');
      this.proc.once('exit',(code,signal)=>this.failTransport(new Error(`Codex app-server exited (${code??signal})`)));
      this.proc.stdin.on('error',e=>this.failTransport(e));
    }
    await this.request('initialize',{clientInfo:{name:'chibirigkit',title:'ChibiRigKit Auto Rig',version:'1.0.0'},capabilities:{experimentalApi:false}});
    this.notify('initialized',{});
  }
  #handle(line){
    let m;try{m=JSON.parse(line)}catch{return}
    this.messages.push(m);
    if(m.id!=null && !m.method){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(new Error(`${m.error.code}: ${m.error.message}`)):p.resolve(m.result)}return}
    if(m.id!=null && m.method){
      const response=approvalResponse(m.method);
      if(response){this.sendRaw({id:m.id,result:response});return}
      this.sendRaw({id:m.id,error:{code:-32601,message:`Unsupported server request: ${m.method}`}});return
    }
    for(const fn of this.listeners)fn(m);
  }
  failTransport(error){
    if(this.transportError)return;
    this.transportError=error;
    for(const p of this.pending.values())p.reject(error);
    this.pending.clear();
    for(const fn of [...this.listeners])fn({method:'transport/closed',error});
  }
  request(method,params={}){
    if(this.transportError)return Promise.reject(this.transportError);
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
      try{this.sendRaw({method,id,params})}catch(e){this.pending.delete(id);reject(e)}
    });
  }
  notify(method,params={}){this.sendRaw({method,params});}
  on(fn){this.listeners.push(fn);return()=>this.listeners=this.listeners.filter(x=>x!==fn)}
  async modelList(){return this.request('model/list',{limit:100,includeHidden:true})}
  // Thread sandbox is a kebab-case mode; turn sandboxPolicy.type is camelCase.
  async startThread({model,cwd}){return this.request('thread/start',{model,cwd,approvalPolicy:'never',sandbox:'workspace-write',serviceName:'chibirigkit'})}
  async resumeThread({threadId,model,cwd}){return this.request('thread/resume',{threadId,model,cwd,approvalPolicy:'never',sandbox:'workspace-write'})}
  async runTurn({threadId,model,effort='high',cwd,input,timeoutMs=0,progressIntervalMs=30_000,onStarted=()=>{},onProgress=()=>{},outputSchema=null,streamText=true}){
    if(!Number.isFinite(timeoutMs)||timeoutMs<0)throw new Error('timeoutMs must be nonnegative (0 = no deadline)');
    const startIndex=this.messages.length,started=Date.now();
    const result=await this.request('turn/start',{threadId,input,cwd,approvalPolicy:'never',sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true},model,effort,summary:'concise',...(outputSchema?{outputSchema}:{})});
    const turnId=result.turn.id;
    onStarted({threadId,turnId});
    let finalText='',lastActivity=started,lastEvent='turn/start',lastItem=null;
    return await new Promise((resolve,reject)=>{
      let off=()=>{},deadline,heartbeat,settled=false;
      const finish=(error,status)=>{
        if(settled)return;settled=true;off();clearTimeout(deadline);clearInterval(heartbeat);
        if(error)reject(Object.assign(error,{threadId,turnId}));else resolve({turnId,status,finalText});
      };
      const consume=m=>{
        if(m.method==='transport/closed'){finish(m.error);return}
        const p=m.params;
        if(!p||p.threadId&&p.threadId!==threadId||p.turnId&&p.turnId!==turnId)return;
        if(m.method==='turn/completed'){
          if(p.turn?.id!==turnId)return;
          const status=p.turn.status;
          if(status==='completed')finish(null,status);
          else finish(new Error(`Codex turn ${status}: ${JSON.stringify(p.turn.error||{})}`));
          return;
        }
        // Ignore unrelated global/server notifications when reporting turn progress.
        if(p.threadId!==threadId&&p.turnId!==turnId)return;
        lastActivity=Date.now();lastEvent=m.method;lastItem=p.item?.type||lastItem;
        if(m.method==='item/completed'&&p.item?.type==='agentMessage'&&p.item.text)finalText=p.item.text;
        if(streamText&&m.method==='item/agentMessage/delta'&&p.delta)process.stdout.write(p.delta);
      };
      off=this.on(consume);
      if(this.transportError){finish(this.transportError);return}
      for(const m of this.messages.slice(startIndex)){consume(m);if(settled)return}
      if(progressIntervalMs>0)heartbeat=setInterval(()=>{
        try{onProgress({threadId,turnId,elapsedMs:Date.now()-started,silentMs:Date.now()-lastActivity,lastEvent,lastItem})}
        catch(e){finish(e)}
      },progressIntervalMs);
      if(timeoutMs>0)deadline=setTimeout(()=>{
        // A requested deadline must not leave a remote turn working invisibly.
        this.request('turn/interrupt',{threadId,turnId}).catch(()=>{});
        finish(new Error(`Codex turn timeout after ${timeoutMs/60000} minutes: ${turnId}. Saved files remain; resume thread ${threadId}.`));
      },timeoutMs);
    });
  }
  close(){this.failTransport(new Error('Codex app-server client closed'));try{this.ws?.close()}catch{};try{this.proc?.kill()}catch{}}
}
