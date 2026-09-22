#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
// Offline protocol fixture: never calls a model or runs browser rendering.
import readline from 'node:readline';
import fs from 'node:fs';
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(m.id===undefined)return;
  fs.appendFileSync('work/test-wire.jsonl',JSON.stringify(m)+'\n');
  let result={};
  if(m.method==='model/list')result={data:[{id:'gpt-6-astra',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]};
  if(['thread/start','thread/resume'].includes(m.method))result={thread:{id:'fixture-thread',cwd:process.cwd(),turns:[]}};
  if(m.method==='turn/start'){
    const request=JSON.parse(m.params.input[0].text);
    if(request.protocol!=='chibirigkit.task/v1'||!m.params.outputSchema){send({id:m.id,error:{code:-32600,message:'Missing workflow contract or output schema'}});return}
    const turnId=`turn-${m.id}`,threadId=m.params.threadId;
    send({id:m.id,result:{turn:{id:turnId}}});
    const report={status:'ready_for_validation',artifacts:[...request.phase_spec.required_outputs,'work/masks/'],issues:[]};
    send({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',text:JSON.stringify(report)}}});
    send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});return;
  }
  send({id:m.id,result});
});
