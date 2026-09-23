// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
const http=require('node:http'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {writeExport}=require('./export_player.cjs'),{renderProject}=require('./render_player.cjs');
const {createPlayerSync}=require('./player_sync.cjs');
const {trackingAvailable,ensureTracking}=require('./tracking_assets.cjs');
const ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.json':'application/json','.task':'application/octet-stream','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.pdf':'application/pdf'};
function createStudio({port=5510,root=path.join(ROOT,'characters/milkc0de'),distRoot,indexFile}={}){
 root=path.resolve(root);const identityFile=path.join(root,fs.existsSync(path.join(root,'rig.project.json'))?'rig.project.json':'index.html');
 const playerSync=createPlayerSync({character:crypto.createHash('sha256').update(fs.existsSync(identityFile)?fs.readFileSync(identityFile):root).digest('hex')});
 const token=crypto.randomBytes(32).toString('hex');
 const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
 const equal=value=>typeof value==='string'&&Buffer.byteLength(value)===Buffer.byteLength(token)&&crypto.timingSafeEqual(Buffer.from(value),Buffer.from(token));
 const hosts=()=>new Set([`127.0.0.1:${server.address()?.port}`,`localhost:${server.address()?.port}`]);
 const sameOrigin=req=>!req.headers.origin||[...hosts()].some(host=>req.headers.origin===`http://${host}`);
 const body=req=>new Promise((resolve,reject)=>{const chunks=[];let size=0;req.on('data',b=>{size+=b.length;if(size>96*1024*1024){reject(Error('完成品のサイズが大きすぎます'));req.destroy()}else chunks.push(b)});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()||'{}'))}catch{reject(Error('JSONが不正です'))}});req.on('error',reject)});
 const server=http.createServer(async(req,res)=>{
  try{
   if(!hosts().has(req.headers.host)||!sameOrigin(req))return json(res,403,{error:'localhostからのみ利用できます'});
   const url=new URL(req.url,'http://localhost');
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
   // SDK, models and inference stay local; external SDK metrics are blocked.
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'");
   if(url.pathname==='/api/tracking'&&req.method==='GET')return json(res,200,{camera:trackingAvailable(),setupToken:token});
   if(url.pathname==='/api/tracking/setup'&&req.method==='POST'){if(!equal(req.headers['x-chibirig-token']))return json(res,403,{error:'操作画面からのみ準備できます'});await ensureTracking();return json(res,200,{camera:true})}
   if(await playerSync.handle(req,res,url,body,json))return;
   if(url.pathname==='/api/session'&&req.method==='GET')return json(res,200,{token,port:server.address().port,format:'ChibiRigMotion',version:1});
   if(url.pathname.startsWith('/api/')){
    if(!equal(req.headers['x-chibirig-token']))return json(res,403,{error:'操作トークンが不正です'});
    if(url.pathname==='/api/player/export'&&req.method==='POST')return json(res,200,await writeExport(root,await body(req),distRoot));
    return json(res,404,{error:'操作がありません'});
   }
   if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
   const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'');
   if(relative==='index.html'||relative==='obs'){
    const html=indexFile?await fsp.readFile(indexFile,'utf8'):fs.existsSync(path.join(root,'rig.project.json'))?renderProject(root):await fsp.readFile(path.join(root,'index.html'),'utf8');
    res.writeHead(200,{'Content-Type':MIME['.html'],'Cache-Control':'no-store'});return res.end(req.method==='HEAD'?undefined:playerSync.inject(html,relative==='obs'));
   }
   if(!/^(runtime|vendor|docs)\//.test(relative))return json(res,404,{error:'Not found'});
   const [folder,...segments]=relative.split('/'),staticRoot=folder==='runtime'?path.join(ROOT,'template/workspace/runtime'):path.join(ROOT,folder);
   const resolved=await fsp.realpath(path.resolve(staticRoot,...segments));if(!resolved.startsWith(staticRoot+path.sep))return json(res,403,{error:'Forbidden'});
   const stat=await fsp.stat(resolved);if(!stat.isFile())return json(res,404,{error:'Not found'});
   res.writeHead(200,{'Content-Type':MIME[path.extname(resolved)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else fs.createReadStream(resolved).pipe(res);
  }catch(e){if(!res.headersSent)json(res,e.code==='ENOENT'?404:400,{error:e.message});else res.end()}
 });
 // No frame relay, popup, virtual camera or player-file upload endpoint.
 server.on('upgrade',(_req,socket)=>{socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')});
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve()})}),close:()=>new Promise(resolve=>{playerSync.close();server.close(resolve)})};
}
module.exports={createStudio};
