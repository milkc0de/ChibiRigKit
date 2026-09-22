const {ROOT,CHARACTER,RUNTIME,playerHTML}=require('./paths.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createStudio}=require('../../studio/server.cjs'),Motion=require('../../template/workspace/runtime/motion_clip.js');
const {launcherFiles}=require('../../studio/player_launchers.cjs'),launchers=launcherFiles();
test('parent server serves current runtime and has no popup, frame or player import API',async()=>{
 const app=createStudio({root:CHARACTER,port:0});await app.listen();
 try{
  const origin=`http://127.0.0.1:${app.server.address().port}`,session=await(await fetch(origin+'/api/session')).json(),headers={'X-ChibiRig-Token':session.token,'Content-Type':'application/json'};
  const html=await(await fetch(origin)).text();assert.match(html,/trackingHeadOff/);assert.ok(!html.includes('id="playerImport"'));assert.ok(!html.includes('id="desktopOutput"'));
  assert.equal((await fetch(origin+'/runtime/tracking_worker.js')).status,200);
  assert.equal((await fetch(origin+'/api/session',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(origin+'/api/player/export',{method:'POST'})).status,403);
  for(const endpoint of ['/api/player/import','/api/output/start','/api/output/stop','/api/popup/open'])assert.equal((await fetch(origin+endpoint,{method:'POST',headers,body:'{}'})).status,404);
  for(const endpoint of ['/api/frame','/desktop/index.html','/tmp/motion.json'])assert.equal((await fetch(origin+endpoint,{headers})).status,404);
 }finally{await app.close()}
});
test('completed HTML and ZIP save only under dist through the authenticated export action',async()=>{
 const vm=require('node:vm'),root=await fs.mkdtemp(path.join(os.tmpdir(),'chibi-export-')),distRoot=path.join(root,'dist');
 await fs.writeFile(path.join(root,'index.html'),'player');await fs.writeFile(path.join(root,'LICENSE.txt'),'MIT');
 const app=createStudio({root,distRoot,port:0});await app.listen();
 try{
  const origin=`http://127.0.0.1:${app.server.address().port}`,{token}=await(await fetch(origin+'/api/session')).json();
  const project={name:'hero',canvas:{width:100,height:100},parts:{face:{file:'assets/layers/face.png',image_data_url:'data:image/png;base64,AQID'}},draw_order:['face']};
  const html='<script id="projectData" type="application/json">'+JSON.stringify(project)+'</script>',c=vm.createContext({TextEncoder,Blob,$:()=>({})});vm.runInContext(await fs.readFile(RUNTIME+'/bundle.js','utf8'),c);
  const zip=Buffer.from(await c.createZip({...launchers,'index.html':html,'LICENSE.txt':'MIT'}).arrayBuffer()).toString('base64');
  await fs.mkdir(path.join(distRoot,'hero/assets'),{recursive:true});await fs.writeFile(path.join(distRoot,'hero/capture.chibimotion.json'),'private');await fs.writeFile(path.join(distRoot,'hero/assets/old.png'),'private');await fs.writeFile(path.join(distRoot,'hero/rig.project.json'),JSON.stringify({parts:{old:{file:'assets/old.png'}}}));await fs.writeFile(path.join(distRoot,'hero/user-note.txt'),'keep');
  const response=await fetch(origin+'/api/player/export',{method:'POST',headers:{'X-ChibiRig-Token':token,'Content-Type':'application/json'},body:JSON.stringify({html,zip})});assert.equal(response.status,200);const saved=await response.json();
  assert.equal(saved.html,path.join(distRoot,'hero/index.html'));assert.equal(saved.zip,path.join(distRoot,'hero.zip'));assert.equal(await fs.readFile(saved.html,'utf8'),html);assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),'player');assert.equal(require('../../studio/player_bundle.cjs').zipHTML(await fs.readFile(saved.zip)),html);
  await assert.rejects(fs.stat(path.join(distRoot,'hero/capture.chibimotion.json')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(distRoot,'hero/assets/old.png')),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(distRoot,'hero/user-note.txt'),'utf8'),'keep');
  const {writeExport}=require('../../studio/export_player.cjs');await assert.rejects(writeExport(root,{html:html+'bad',zip},distRoot));
  assert.deepEqual((await fs.readdir(path.join(distRoot,'hero'))).sort(),['LICENSE.txt','index.html','user-note.txt','runtime','vendor','licenses',...Object.keys(launchers)].sort());
  for(const extra of [{'assets/face.png':'duplicate'},{'rig.project.json':'duplicate'},{'notes.txt':'private'}]){
   const legacyZip=Buffer.from(await c.createZip({...launchers,'index.html':html,'LICENSE.txt':'MIT',...extra}).arrayBuffer()).toString('base64');
   await assert.rejects(writeExport(root,{html,zip:legacyZip},distRoot),/現在の形式と一致/);
  }
  const altered=Buffer.from(await c.createZip({...launchers,'index.html':html,'LICENSE.txt':'MIT','START_SERVER.sh':'bad'}).arrayBuffer()).toString('base64');
  await assert.rejects(writeExport(root,{html,zip:altered},distRoot),/起動ファイル/);
  for(const [name,bytes] of Object.entries(require('../../studio/tracking_assets.cjs').trackingFiles()))assert.deepEqual(await fs.readFile(path.join(distRoot,'hero',name)),bytes);
  for(const name of ['START_SERVER.sh','START_SERVER.command'])assert.equal((await fs.stat(path.join(distRoot,'hero',name))).mode&0o777,0o755);
  assert.equal(require('../../studio/player_bundle.cjs').zipHTML(await fs.readFile(saved.zip)),html);

 }finally{await app.close();await fs.rm(root,{recursive:true,force:true})}
});
test('parent camera player exposes a read-only OBS view and relays settings and live values locally',async()=>{
 const app=createStudio({root:CHARACTER,port:0});await app.listen();let reader;
 try{
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  assert.match(await(await fetch(origin+'/obs')).text(),/"role":"view"/);
  const session=await(await fetch(origin+'/api/player-sync/session')).json(),headers={'Content-Type':'application/json','X-ChibiRig-Sync-Token':session.token};
  const response=await fetch(origin+'/api/player-sync/events?token='+session.token);reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
  async function event(name){for(;;){const split=buffer.indexOf('\n\n');if(split>=0){const block=buffer.slice(0,split);buffer=buffer.slice(split+2);if(block.startsWith('event: '+name+'\n'))return JSON.parse(block.split('\ndata: ')[1]);continue}const next=await reader.read();if(next.done)throw Error('Stream ended');buffer+=decoder.decode(next.value,{stream:true})}}
  assert.equal((await event('settings')).state,null);assert.equal((await event('live')).active,false);
  const payload={character:session.character,live:{active:true,values:{headYaw:12,mouthOpen:.6}}};
  assert.equal((await fetch(origin+'/api/player-sync/live',{method:'POST',headers,body:JSON.stringify(payload)})).status,200);const live=await event('live');assert.equal(live.values.headYaw,12);
  assert.equal((await fetch(origin+'/api/player-sync/live',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(payload)})).status,403);
  payload.live={active:false,values:{}};await fetch(origin+'/api/player-sync/live',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal((await event('live')).active,false);
 }finally{await reader?.cancel();await app.close()}
});
