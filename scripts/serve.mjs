#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createStudio}=require('../studio/server.cjs');
const kit=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function arg(name,def=null){const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:def}
const root=path.resolve(arg('character',path.join(kit,'characters/milkc0de'))),port=Number(arg('port','8080'));
if(!fs.existsSync(path.join(root,'rig.project.json')))throw Error(`キャラの rig.project.json がありません: ${root}`);
const studio=createStudio({root,port});studio.listen().then(()=>console.log(`http://127.0.0.1:${studio.server.address().port}/ -> ${root}\n最新の共通ランタイムで開きます。完成品とZIPはdistへ保存します。カメラ・マイクは開始ボタンを押すまで停止しています。`)).catch(error=>{console.error(error.message);process.exitCode=1});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>studio.close().then(()=>process.exit()));
