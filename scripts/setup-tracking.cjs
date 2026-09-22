// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
(async()=>{
 const vendor=path.join(root,'vendor/mediapipe');await fs.mkdir(path.join(vendor,'models'),{recursive:true});
 const pkg=path.dirname(require.resolve('@mediapipe/tasks-vision'));
 const metadata=JSON.parse(await fs.readFile(path.join(pkg,'package.json')));if(metadata.version!=='1.0.1')throw Error('Unexpected tracking SDK version');
 for(const f of ['vision_bundle.js','vision_bundle.mjs','wasm'])await fs.cp(path.join(pkg,f),path.join(vendor,f),{recursive:true});
 const urls={
  'vendor/mediapipe/models/face_landmarker.task':'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
 };
 for(const [file,url] of Object.entries(urls)){const r=await fetch(url);if(!r.ok)throw Error(file+': '+r.status);await fs.writeFile(path.join(root,file),Buffer.from(await r.arrayBuffer()))}
 const manifest={version:metadata.version,registry:'https://registry.npmjs.org/@mediapipe/tasks-vision/1.0.1',license:'Apache-2.0',files:[]};
 async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())await walk(f);else{const b=await fs.readFile(f);manifest.files.push({path:path.relative(root,f).split(path.sep).join('/'),bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),source:urls[path.relative(root,f).split(path.sep).join('/')]||'@mediapipe/tasks-vision@1.0.1'})}}}
 await walk(vendor);await fs.writeFile(path.join(root,'tracking-dependencies.json'),JSON.stringify(manifest,null,2)+'\n');console.log('Tracking SDK and model installed locally.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
