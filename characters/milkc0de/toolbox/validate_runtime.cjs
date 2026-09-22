#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
// Exercise the actual generated browser renderer, including file:// loading.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),checks=path.join(root,'checks');
(async()=>{
  fs.mkdirSync(checks,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chrome'})});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root,'index.html')).href+'?validate=1');
    await page.evaluate(()=>window.rigReady);
    await page.addScriptTag({path:path.join(__dirname,'head_checks.js')});
    await page.addScriptTag({path:path.join(__dirname,'neck_checks.js')});
    await page.addScriptTag({path:path.join(__dirname,'motion_io_checks.js')});
    await page.addScriptTag({path:path.join(__dirname,'runtime_checks.js')});
    const result=await page.evaluate(()=>window.runRigChecks());
    assert.deepEqual(errors,[]);
    const {png,...report}=result;
    if(report.neck?.png){fs.writeFileSync(path.join(checks,'neck-sway.png'),Buffer.from(report.neck.png,'base64'));delete report.neck.png}
    if(report.head?.png){fs.writeFileSync(path.join(checks,'head-directions.png'),Buffer.from(report.head.png,'base64'));delete report.head.png}
    fs.writeFileSync(path.join(checks,'runtime_sheet.png'),Buffer.from(png,'base64'));
    await page.screenshot({path:path.join(checks,'runtime_ui.png')});
    fs.writeFileSync(path.join(checks,'runtime-report.json'),JSON.stringify({...report,browserErrors:errors},null,2)+'\n');
    console.log(JSON.stringify(report));
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
