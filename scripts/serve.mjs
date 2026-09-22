#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
function arg(name,def=null){const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:def}
const root=path.resolve(arg('character','.')||'.'),port=Number(arg('port','8080'));const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webm':'video/webm'};
http.createServer((req,res)=>{let rel=decodeURIComponent((req.url||'/').split('?')[0]);if(rel==='/')rel='/index.html';const p=path.resolve(root,'.'+rel);if(!p.startsWith(root)){res.writeHead(403);return res.end()}fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);res.end('not found')}else{res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream'});res.end(d)}})}).listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}/  -> ${root}`));
