#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {CodexAppServer} from './codex-app-server.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(HERE,'..');
function arg(name,def=null){const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:def}
const charArg=arg('character');if(!charArg){console.error('Usage: npm run auto -- --character ./characters/name');process.exit(2)}
const workspace=path.resolve(charArg),cfgPath=path.join(workspace,'character.config.json');if(!fs.existsSync(cfgPath))throw new Error(`Not a character workspace: ${workspace}`);
const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8')),py=arg('python',process.env.PYTHON||(fs.existsSync(path.join(ROOT,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'))?path.join(ROOT,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'):'python3'));
function run(cmd,args){console.log(`\n$ ${cmd} ${args.join(' ')}`);const r=spawnSync(cmd,args,{cwd:workspace,stdio:'inherit',env:{...process.env,NODE_PATH:[path.join(ROOT,'node_modules'),process.env.NODE_PATH].filter(Boolean).join(path.delimiter)}});if(r.status!==0)throw new Error(`${cmd} failed (${r.status})`)}
const timeoutMinutes=Number(arg('turn-timeout-minutes',cfg.turn_timeout_minutes??0));
if(!Number.isFinite(timeoutMinutes)||timeoutMinutes<0||timeoutMinutes*60000>2147483647)throw new Error('turn-timeout-minutes must be 0 (unlimited) or a positive duration below 35791 minutes');
const checkpointPath=path.join(workspace,'work/codex-run.json');
const wantsResume=process.argv.includes('--resume'),explicitResume=arg('resume-thread');
const saved=wantsResume&&fs.existsSync(checkpointPath)?JSON.parse(fs.readFileSync(checkpointPath,'utf8')):null;
const resumeId=explicitResume||(wantsResume?saved?.threadId:null);
if(wantsResume&&!resumeId)throw new Error('No saved thread. Use --resume-thread THREAD_ID for an older interrupted run.');
if(!fs.existsSync(path.join(workspace,'toolbox/player_output.py'))||!fs.existsSync(path.join(workspace,'rig.workflow.json'))||!fs.existsSync(path.join(workspace,'templates/results/rigging.json')))run(py,[path.join(ROOT,'scripts/update-character.py'),'--character',workspace]);
run(py,['toolbox/validate_workflow.py']);
const workflow=JSON.parse(fs.readFileSync(path.join(workspace,'rig.workflow.json'),'utf8'));
const resultSchema=JSON.parse(fs.readFileSync(path.join(workspace,'rig.result.schema.json'),'utf8'));
run(py,['toolbox/normalize_inputs.py']);
function sourceSnapshot(){
  return JSON.stringify(['input','work/aligned'].flatMap(folder=>fs.readdirSync(path.join(workspace,folder),{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const file=path.join(e.parentPath,e.name);return [path.relative(workspace,file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]})).sort((a,b)=>a[0].localeCompare(b[0])));
}
function implementationSnapshot(){
  const files=['character.config.json','rig.workflow.json','rig.workflow.schema.json','rig.result.schema.json'];
  for(const folder of ['toolbox','runtime','templates/results'])for(const entry of fs.readdirSync(path.join(workspace,folder),{recursive:true,withFileTypes:true})){
    if(entry.isFile()&&/\.(py|js|cjs|html|json)$/.test(entry.name))files.push(path.relative(workspace,path.join(entry.parentPath,entry.name)));
  }
  return JSON.stringify(files.sort().map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace,file))).digest('hex')]));
}
const implementationBaseline=implementationSnapshot();
let sourceBaseline=sourceSnapshot();
function verify(){
  if(sourceSnapshot()!==sourceBaseline)throw new Error('Source images changed during the agent turn; review stopped. Restore originals before continuing.');
  run(py,['toolbox/build_project.py']);run(py,['toolbox/validate_character.py']);
  run(py,['toolbox/validate_workflow.py','--report','checks/report.json','--acceptance','static']);
  run(process.execPath,['toolbox/validate_runtime.cjs']);
  run(py,['toolbox/validate_workflow.py','--report','checks/runtime-report.json','--acceptance','runtime']);
}

const aligned=path.join(workspace,'work','aligned');
function alignedImages(){return ['normal','flat','blink','mouth_closed'].map(role=>path.join(aligned,`${role}.png`)).filter(fs.existsSync).map(p=>({type:'localImage',path:p}))}
const url=arg('app-server',process.env.CODEX_APP_SERVER_URL||null),codexBin=arg('codex-bin',process.env.CODEX_BIN||'codex'),server=new CodexAppServer({url,codexBin,cwd:workspace}),transcript=saved?.turns||[];
const checkpoint={model:'gpt-6-astra',effort:'high',workspace,threadId:resumeId,turns:transcript};
function saveCheckpoint(update){
  Object.assign(checkpoint,update,{updatedAt:new Date().toISOString()});
  fs.mkdirSync(path.dirname(checkpointPath),{recursive:true});
  fs.writeFileSync(checkpointPath+'.tmp',JSON.stringify(checkpoint,null,2)+'\n');
  fs.renameSync(checkpointPath+'.tmp',checkpointPath);
}
function taskInput(phase,images,context={}){
  return [{type:'text',text:JSON.stringify({protocol:'chibirigkit.task/v1',phase,contract:workflow,phase_spec:workflow.phases[phase],result_template:JSON.parse(fs.readFileSync(path.join(workspace,`templates/results/${phase}.json`),'utf8')),artifact_contract:{paths:'workspace_relative',kinds:['file','directory'],must_exist:true,required_outputs:'files_only'},workspace,python:py,resume:Boolean(resumeId),execution:{writable_root:workspace,network_access:false,environment:{CHIBIRIG_DIST_ROOT:path.join(workspace,'work/agent-output'),TMPDIR:path.join(workspace,'work/agent-tmp'),TMP:path.join(workspace,'work/agent-tmp'),TEMP:path.join(workspace,'work/agent-tmp')},final_export:'The parent orchestrator writes kit dist after validation. Agent builds stay in work/agent-output; do not request broader permissions.'},context,schemas:['rig.plan.schema.json','reference.plan.schema.json','rig.result.schema.json']})},...images];
}
async function runPhase(phase,options){
  saveCheckpoint({phase,status:'starting',error:null});
  try{
    const result=await server.runTurn({...options,timeoutMs:timeoutMinutes*60000,outputSchema:resultSchema,streamText:false,
      onStarted:ids=>{saveCheckpoint({...ids,status:'running'});console.log(`[${phase}] turn ${ids.turnId}; ${timeoutMinutes?`${timeoutMinutes} minute limit`:'no fixed time limit'}`)},
      onProgress:progress=>{saveCheckpoint({progress});console.log(`[${phase}] ${(progress.elapsedMs/60000).toFixed(1)} min; last activity ${(progress.silentMs/1000).toFixed(0)}s ago (${progress.lastItem||progress.lastEvent})`)}
    });
    transcript.push({...result,phase});saveCheckpoint({status:'validating-phase'});
    if(implementationSnapshot()!==implementationBaseline)throw new Error('The workflow contract or protected implementation changed during the agent turn');
    if(sourceSnapshot()!==sourceBaseline)throw new Error('Source images changed during the agent turn');
    const report=JSON.parse(result.finalText),reportPath=`work/phase-${phase}.json`;
    fs.writeFileSync(path.join(workspace,reportPath),JSON.stringify(report,null,2)+'\n');
    run(py,['toolbox/validate_workflow.py','--phase',phase.startsWith('review-')?'review':phase,'--report',reportPath]);
    saveCheckpoint({status:'phase-completed'});return result;
  }catch(error){saveCheckpoint({status:'interrupted',error:error.message});throw error}
}
try{
  await server.connect();
  const list=await server.modelList(),models=list.data||[];const astra=models.find(x=>x.model==='gpt-6-astra'||x.id==='gpt-6-astra');
  if(!astra)throw new Error('gpt-6-astra is not available in model/list. ChibiRigKit is configured to require Astra.');
  const efforts=(astra.supportedReasoningEfforts||[]).map(x=>x.reasoningEffort);if(efforts.length&&!efforts.includes('high'))throw new Error(`gpt-6-astra does not advertise high effort. Supported: ${efforts.join(', ')}`);
  console.log(`Using ${astra.model||astra.id} / reasoning high`);
  const thr=resumeId?await server.resumeThread({threadId:resumeId,model:'gpt-6-astra',cwd:workspace}):await server.startThread({model:'gpt-6-astra',cwd:workspace}),threadId=thr.thread.id;
  if(thr.thread.cwd&&path.resolve(thr.thread.cwd)!==workspace)throw new Error('Resumed thread belongs to a different workspace');
  if(thr.thread.turns?.some(t=>t.status==='inProgress'))throw new Error('This thread still has an active turn; do not start a second rigging run');
  saveCheckpoint({threadId,status:'connected'});
  const missing=['flat','blink','mouth_closed'].filter(role=>!fs.existsSync(path.join(aligned,`${role}.png`)));
  if(missing.length&&cfg.auto_generate_references!==false){
    console.log(`Preparing missing references: ${missing.join(', ')}`);
    await runPhase('reference-planning',{threadId,model:workflow.engine.model,effort:workflow.engine.effort,cwd:workspace,input:taskInput('reference-planning',[{type:'localImage',path:path.join(aligned,'normal.png')}],{missing_references:missing})});
    if(sourceSnapshot()!==sourceBaseline)throw new Error('Source images changed during reference planning');
    run(py,['toolbox/generate_references.py']);run(py,['toolbox/normalize_inputs.py']);
    for(const role of missing)if(!fs.existsSync(path.join(aligned,`${role}.png`)))throw new Error(`Missing generated reference: ${role}`);
    sourceBaseline=sourceSnapshot();
  }
  const imageInputs=alignedImages();
  const referenceSheet=path.join(workspace,'checks/generated_references.png');
  if(fs.existsSync(referenceSheet))imageInputs.push({type:'localImage',path:referenceSheet});
  await runPhase('rigging',{threadId,model:workflow.engine.model,effort:workflow.engine.effort,cwd:workspace,input:taskInput('rigging',imageInputs)});
  // Ensure deterministic build/validation are the final steps even if the agent forgot one.
  if(!fs.existsSync(path.join(workspace,'rig.plan.json')))throw new Error('Astra turn completed without creating rig.plan.json');
  verify();
  const passes=Number(cfg.review_passes??2);
  for(let pass=1;pass<=passes;pass++){
    const checks=['validation_sheet.png','base_only.png','runtime_sheet.png','head-directions.png','open_diff.png','blink_diff.png'].map(n=>path.join(workspace,'checks',n)).filter(fs.existsSync);
    if(!checks.length)break;
    await runPhase(`review-${pass}`,{threadId,model:workflow.engine.model,effort:workflow.engine.effort,cwd:workspace,input:taskInput('review',checks.map(p=>({type:'localImage',path:p})),{pass,total_passes:passes})});
    verify();
  }
  saveCheckpoint({status:'completed',phase:'done'});
  console.log(`\nBuilt and checked (visual quality still requires review): ${workspace}`);const output=JSON.parse(fs.readFileSync(path.join(workspace,'work/player-output.json'),'utf8'));console.log(`Open ${output.html}\nZIP ${output.zip}`);
}catch(error){
  if(checkpoint.threadId)saveCheckpoint({status:'failed',error:error.message});
  throw error;
}finally{server.close()}
