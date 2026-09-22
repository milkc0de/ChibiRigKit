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
  assert.equal(saved.html,path.join(distRoot,'hero/index.html'));assert.equal(saved.zip,path.join(distRoot,'hero.zip'));assert.equal(await fs.readFile(saved.html,'utf8'),html);assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),'player');assert.deepEqual(await fs.readFile(saved.zip),Buffer.from(zip,'base64'));
  await assert.rejects(fs.stat(path.join(distRoot,'hero/capture.chibimotion.json')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(distRoot,'hero/assets/old.png')),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(distRoot,'hero/user-note.txt'),'utf8'),'keep');
  const {writeExport}=require('../../studio/export_player.cjs');await assert.rejects(writeExport(root,{html:html+'bad',zip},distRoot));
  assert.deepEqual((await fs.readdir(path.join(distRoot,'hero'))).sort(),['LICENSE.txt','index.html','user-note.txt',...Object.keys(launchers)].sort());
  for(const extra of [{'assets/face.png':'duplicate'},{'rig.project.json':'duplicate'},{'notes.txt':'private'}]){
   const legacyZip=Buffer.from(await c.createZip({...launchers,'index.html':html,'LICENSE.txt':'MIT',...extra}).arrayBuffer()).toString('base64');
   await assert.rejects(writeExport(root,{html,zip:legacyZip},distRoot),/現在の形式と一致/);
  }
  const altered=Buffer.from(await c.createZip({...launchers,'index.html':html,'LICENSE.txt':'MIT','START_SERVER.sh':'bad'}).arrayBuffer()).toString('base64');
  await assert.rejects(writeExport(root,{html,zip:altered},distRoot),/起動ファイル/);
  for(const name of ['START_SERVER.sh','START_SERVER.command'])assert.equal((await fs.stat(path.join(distRoot,'hero',name))).mode&0o777,0o755);
  assert.deepEqual(await fs.readFile(saved.zip),Buffer.from(zip,'base64'));

 }finally{await app.close();await fs.rm(root,{recursive:true,force:true})}
});
