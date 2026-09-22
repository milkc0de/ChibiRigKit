// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {ensureTracking}=require('../studio/tracking_assets.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const files=await ensureTracking();
 const manifest={version:'1.0.1',registry:'https://registry.npmjs.org/@mediapipe/tasks-vision/1.0.1',license:'Apache-2.0',files:Object.entries(files).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}))};
 await fs.writeFile(path.join(root,'tracking-dependencies.json'),JSON.stringify(manifest,null,2)+'\n');console.log('Tracking SDK and model installed and verified locally.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
