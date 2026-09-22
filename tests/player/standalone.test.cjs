const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ROOT,CHARACTER}=require('./paths.cjs'),{browserHarness}=require('./browser-harness.cjs');
test('copied parent runtime starts without the old player directory or Electron dependencies',async()=>{
 const isolated=await fs.mkdtemp(path.join(os.tmpdir(),'chibirig-parent-only-'));let app;
 try{
  for(const folder of ['studio','template/workspace/runtime','template/workspace/launchers'])await fs.cp(path.join(ROOT,folder),path.join(isolated,folder),{recursive:true});
  const character=path.join(isolated,'characters/example');await fs.mkdir(character,{recursive:true});
  for(const file of ['rig.project.json','LICENSE.txt'])await fs.copyFile(path.join(CHARACTER,file),path.join(character,file));
  const {createStudio}=require(path.join(isolated,'studio/server.cjs'));app=createStudio({root:character,port:0});await app.listen();
  const origin=`http://127.0.0.1:${app.server.address().port}`,response=await fetch(origin);assert.equal(response.status,200);const html=await response.text(),fixture=browserHarness(html);await fixture.context.rigReady;
  assert.equal(fixture.elements.get('loadStatus').textContent,'読み込み完了');assert.ok(fixture.elements.get('cameraStart'));assert.ok(fixture.elements.get('captureLoad'));assert.equal(fixture.elements.get('playerImport'),undefined);
  assert.equal((await fetch(origin+'/runtime/tracking_worker.js')).status,200);
  const session=await(await fetch(origin+'/api/session')).json();assert.equal(session.format,'ChibiRigMotion');
 }finally{await app?.close();await fs.rm(isolated,{recursive:true,force:true})}
});
