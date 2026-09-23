#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'tests/test-cases.json'),'utf8'));
if(manifest.version!==1)throw Error('Unsupported test manifest');
const python=process.env.PYTHON||(fs.existsSync(path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'))?path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'):'python3');
fs.mkdirSync(path.join(root,'work'),{recursive:true});
const results=[];
for(const suite of manifest.suites){
  let command,args;
  if(suite.runner==='python-unittest'){command=python;args=['-m','unittest','discover','-s',suite.directory,'-p',suite.pattern,'-v']}
  else if(suite.runner==='node-test'){command=process.execPath;args=['--test',...fs.readdirSync(path.join(root,suite.directory)).filter(f=>f.endsWith(suite.suffix)).sort().map(f=>path.join(suite.directory,f))]}
  else throw Error(`Unknown runner: ${suite.runner}`);
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit',env:{...process.env,CHIBIRIG_DIST_ROOT:path.join(root,'work/test-dist')}});
  results.push({suite:suite.id,status:result.status===0?'passed':'failed',exitCode:result.status});
  if(result.status!==0)break;
}
const report={version:1,status:results.length===manifest.suites.length&&results.every(r=>r.status==='passed')?'passed':'failed',suites:results};
fs.writeFileSync(path.join(root,'work/test-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
process.exitCode=report.status==='passed'?0:1;
