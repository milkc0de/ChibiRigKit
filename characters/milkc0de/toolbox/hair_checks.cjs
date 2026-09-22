const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),c={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(root,'runtime/hair_dynamics.js'),'utf8'),c);const h=c.module.exports;
assert.equal(h.response(5,()=>0),0);assert.equal(h.response(5,()=>50),0);
const driver=t=>t<1?0:t<1.5?50*(.5-.5*Math.cos((t-1)*Math.PI/.5)):50;
const samples=Array.from({length:601},(_,i)=>[i/90,h.response(i/90,driver)]);
assert.ok(samples.some(([,a])=>Math.abs(a)>.02));assert.ok(Math.abs(h.response(6,driver))<1e-4);
for(const [t,a] of samples){assert.equal(h.response(t,driver),a);assert.ok(Number.isFinite(a)&&Math.abs(a)<=.18)}
const roots=vm.createContext({hairFrame:new Map([['hair_back_left',.1]])});
const player=fs.readFileSync(path.join(root,'runtime/hair_player.js'),'utf8');vm.runInContext(player.slice(player.indexOf('function hairDeformedPoint(')),roots);
assert.deepEqual(Array.from(vm.runInContext("hairDeformedPoint({name:'hair_back_left',y:100,h:450},[20,100],[30,110])",roots)),[30,110]);
const tip=vm.runInContext("hairDeformedPoint({name:'hair_back_left',y:100,h:450},[20,550],[30,560])",roots);assert.ok(tip[0]>30&&tip[1]<560);
console.log(JSON.stringify({gravityAndSpring:true,restStable:true,rootFixed:true,tipLagAndLift:true,seekDeterministic:true,settles:true,samples:samples.length,maxAngle:Math.max(...samples.map(x=>Math.abs(x[1])))}));
