import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{parsePlayer}=require('../studio/player_bundle.cjs'),{browserHarness}=require('./player/browser-harness.cjs'),{playerHTML}=require('./player/paths.cjs');
const template=new URL('../template/workspace/',import.meta.url);
test('parent opens its authored character with the shared runtime and retains capture controls',async()=>{
 const project=JSON.parse(fs.readFileSync(new URL('../characters/milkc0de/rig.project.json',import.meta.url),'utf8')),html=playerHTML();
 assert.deepEqual(parsePlayer(Buffer.from(html)).project,project);assert.ok(!/__\w+_JS__/.test(html));
 const {context,elements}=browserHarness(html);await context.rigReady;assert.equal(elements.get('loadStatus').textContent,'読み込み完了');
 assert.equal(elements.get('c').width,project.canvas.width);assert.equal(elements.get('desktopOutput'),undefined);assert.equal(elements.get('playerImport'),undefined);assert.ok(elements.get('captureLoad'));
});
test('every shared runtime is included by the character updater; parent commands have no submodule dependency',()=>{
 const updater=fs.readFileSync(new URL('../scripts/update-character.py',import.meta.url),'utf8');
 for(const file of fs.readdirSync(new URL('runtime/',template)))assert.ok(updater.includes('runtime/'+file),'missing update entry '+file);
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));assert.ok(!JSON.stringify(pkg).includes('ChibiRigPlayer'));assert.equal(pkg.dependencies.electron,undefined);
 const workflow=JSON.parse(fs.readFileSync(new URL('rig.workflow.json',template),'utf8'));
 assert.deepEqual(workflow.rules.head.reference_yaw_degrees,[-25,0,25]);assert.equal(workflow.rules.player_handoff.network_broadcast,false);assert.equal(workflow.rules.player_handoff.popup,false);assert.equal(workflow.rules.player_handoff.player_file_import,false);
});
