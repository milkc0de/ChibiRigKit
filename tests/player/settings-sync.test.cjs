const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {browserHarness}=require('./browser-harness.cjs');
const run=(f,code)=>vm.runInContext(code,f.context),plain=value=>JSON.parse(JSON.stringify(value));
test('independent player receives appearance, gains, head layout, background and crop without devices',async()=>{
 const control=browserHarness(),view=browserHarness();await Promise.all([control.context.rigReady,view.context.rigReady]);
 run(control,`$('captureYawGain').value='1.8';$('headAmount').value='2';$('hairPhysicsAmount').value='1.4';$('hairPhysics').checked=false;setBackground({version:1,mode:'color',color:'#123456',fit:'cover',image:null,name:'PRIVATE_FILENAME'});outputState.crop={x:10,y:20,w:300,h:400};running=false;pausedAt=3;`);
 const state=plain(control.context.collectPlayerSync());assert.ok(!JSON.stringify(state).includes('PRIVATE_FILENAME'));
 run(view,"playerSync.role='view'");await view.context.applyPlayerSync(state,1);
 assert.equal(Number(view.elements.get('captureYawGain').value),1.8);assert.equal(Number(view.elements.get('hairPhysicsAmount').value),1.4);assert.equal(view.elements.get('hairPhysics').checked,false);
 assert.equal(run(view,'backgroundState.color'),'#123456');assert.equal(run(view,'running'),false);assert.equal(run(view,'pausedAt'),3);
 assert.deepEqual(plain(run(view,'outputState.crop')),state.extras.crop);assert.equal(view.elements.get('c').width,300);assert.equal(view.elements.get('c').height,400);
 assert.deepEqual(plain(run(view,'PROJECT.head_pose')),state.motion.head_pose);assert.equal(run(view,'trackingState.active'),false);
});
test('capture playback is shared with sanitized numeric data and invalid state leaves current view intact',async()=>{
 const a=browserHarness(),b=browserHarness();await Promise.all([a.context.rigReady,b.context.rigReady]);
 a.context.loadCaptureMotion({format:'ChibiRigMotion',version:1,timeUnit:'seconds',duration:2,loop:true,channels:['headYaw','mouthOpen'],frames:[[0,0,0],[2,20,1]],metadata:{name:'PRIVATE_NAME'}},'PRIVATE_NAME');
 run(a,'setCapturePlayback(true);seekCaptureMotion(1)');const data=plain(a.context.collectPlayerSync());assert.ok(!JSON.stringify(data).includes('PRIVATE_NAME'));
 await b.context.applyPlayerSync(data,1);assert.equal(run(b,'capturePlaying'),true);assert.equal(run(b,'captureMotion.clip.duration'),2);
 const before=plain(b.context.collectPlayerSync()),bad=structuredClone(data);bad.extras.hairPhysicsAmount=100;
 await assert.rejects(b.context.applyPlayerSync(bad,2));assert.deepEqual(plain(b.context.collectPlayerSync()),before);
});
test('publisher sends changes once; receiver never publishes and export excludes connection bootstrap',async()=>{
 const a=browserHarness();await a.context.rigReady;const sent=[];
 a.context.fetch=async(url,options)=>{sent.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({revision:1})}};
 run(a,"playerSync.role='control';playerSync.active=true;playerSync.session={token:'test',character:'hero'};");
 await a.context.publishPlayerSync();await a.context.publishPlayerSync();assert.equal(sent.length,1);assert.equal(sent[0].url,'/api/player-sync/state');
 a.elements.get('headAmount').value='2.5';await a.context.publishPlayerSync();assert.equal(sent.length,2);
 run(a,"playerSync.role='view'");await a.context.publishPlayerSync();assert.equal(sent.length,2);
});
test('late viewer initializes from current server state and listens for the next revision',async()=>{
 const a=browserHarness(),b=browserHarness();await Promise.all([a.context.rigReady,b.context.rigReady]);a.elements.get('headAmount').value='2.2';const latest=plain(a.context.collectPlayerSync());
 let events; b.context.EventSource=class{constructor(){events=this;this.listeners={}}addEventListener(name,fn){this.listeners[name]=fn}close(){}};
 b.context.fetch=async url=>({ok:true,json:async()=>url.endsWith('/session')?{token:'token',character:'hero'}:{revision:4,state:latest}});
 run(b,"playerSync.role='view'");await b.context.connectPlayerSync();assert.equal(Number(b.elements.get('headAmount').value),2.2);
 const update=structuredClone(latest);update.motion.settings.head_motion_amount=3;
 events.listeners.settings({data:JSON.stringify({character:'hero',revision:5,state:update})});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(Number(b.elements.get('headAmount').value),3);
 events.listeners.settings({data:JSON.stringify({character:'hero',revision:3,state:latest})});assert.equal(Number(b.elements.get('headAmount').value),3);
});
test('live camera/audio values follow per-region opt-outs, stop and expire without opening viewer devices',async()=>{
 const control=browserHarness(),view=browserHarness();await Promise.all([control.context.rigReady,view.context.rigReady]);const packets=[];
 control.context.fetch=async(_url,options)=>{packets.push(JSON.parse(options.body));return {ok:true}};
 run(control,"playerSync.active=true;playerSync.role='control';playerSync.session={token:'t',character:'c'};trackingState.active=true;trackingState.inputMode='both';trackingState.values={headYaw:18,eyeLeft:.2,mouthOpen:.7};$('trackingEyesOff').checked=true;");
 await control.context.publishPlayerSyncLive(true);assert.deepEqual(packets[0].live,{active:true,values:{headYaw:18,mouthOpen:.7}});
 run(view,"playerSync.role='view'");view.context.receivePlayerSyncLive(packets[0].live);assert.equal(run(view,'captureLiveActive()'),true);assert.equal(run(view,'mixedCaptureFrame(0).headYaw'),18);assert.equal(run(view,'mixedCaptureFrame(0).mouthOpen'),.7);assert.equal(run(view,'trackingState.active'),false);
 run(control,'trackingState.active=false');await control.context.publishPlayerSyncLive(true);view.context.receivePlayerSyncLive(packets.at(-1).live);assert.equal(run(view,'captureLiveActive()'),false);
 view.context.receivePlayerSyncLive({active:true,values:{headYaw:25}});run(view,'playerSyncLive.received=performance.now()-2000;frameDirty=false;expirePlayerSyncLive()');assert.equal(run(view,'captureLiveActive()'),false);assert.equal(run(view,'frameDirty'),true);
});

test('clearing a loaded motion also clears it in the display view',async()=>{
 const control=browserHarness(),view=browserHarness();await Promise.all([control.context.rigReady,view.context.rigReady]);
 control.context.loadCaptureMotion({format:'ChibiRigMotion',version:1,timeUnit:'seconds',duration:2,loop:true,channels:['headYaw'],frames:[[0,0],[2,20]]},'motion');
 await view.context.applyPlayerSync(plain(control.context.collectPlayerSync()),1);assert.equal(run(view,'captureMotion.clip.duration'),2);
 control.context.clearCaptureMotion();await view.context.applyPlayerSync(plain(control.context.collectPlayerSync()),2);
 assert.equal(run(view,'captureMotion'),null);assert.equal(run(view,'capturePlaying'),false);
});
